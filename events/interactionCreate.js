const {
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const queue = require('../utils/queue');
const { buildTicketEmbed, buildMyTicketEmbed, buildQueueStatusEmbed } = require('../utils/embeds');
const { buildTicketButtons } = require('../utils/buttons');
const { refreshPanel, deletePanelMessage } = require('../utils/panel');
const { performTicketClose } = require('../utils/ticketClose');
const { incrementClaimStat } = require('../utils/stats');
const { enqueue, withRetry } = require('../utils/channelQueue');

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const SUMMON_TIMEOUT_MS = 10 * 60 * 1000; // 10 دقائق
const FULL_PERIOD_FAILSAFE_MS = 15 * 60 * 1000; // 15 دقيقة احتياط

function isStaff(member) {
  return STAFF_ROLE_ID ? member.roles.cache.has(STAFF_ROLE_ID) : member.permissions.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // ===== أوامر السلاش =====
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(err);
        const payload = { content: '❌ صار خطأ أثناء تنفيذ الأمر.', ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
      }
      return;
    }

    // ===== إرسال مودال سبب الإغلاق (إغلاق يدوي من الإدارة) =====
    if (interaction.isModalSubmit() && interaction.customId.startsWith('close_reason_')) {
      const ticketId = interaction.customId.split('_')[2];
      const reason = interaction.fields.getTextInputValue('reason').trim();

      // نؤجل الرد فورًا (خلال أول 3 ثواني) قبل أي شغل ثقيل — إرسال اللوق + المرفق +
      // الخاص لصاحب التذكرة يمكن ياخذ أكثر من 3 ثواني، ولو ما أجّلنا يفشل التفاعل
      // بالكامل من طرف ديسكورد (ويسبب كراش صامت بالبوت لو ما لحقنا نمسك الخطأ).
      await interaction.deferReply({ ephemeral: true });

      let ticket;
      try {
        ticket = await performTicketClose({
          client: interaction.client,
          guild: interaction.guild,
          ticketId,
          staffId: interaction.user.id,
          reason,
        });
      } catch (err) {
        if (err.message === 'ALREADY_CLOSED') {
          return interaction.editReply({ content: 'ℹ️ هذه التذكرة مغلقة بالفعل.' });
        }
        console.error(err);
        return interaction.editReply({ content: '❌ صار خطأ أثناء الإغلاق.' });
      }

      await interaction.editReply({ content: `🔒 تم إغلاق التذكرة #${ticket.ticketNumber}.` });
      return;
    }

    if (!interaction.isButton()) return;

    // ===== زر: فتح تذكرة =====
    if (interaction.customId === 'take_ticket') {
      // نرد فورًا (أقل من ثانية) قبل أي استعلام قاعدة بيانات — ديسكورد يعطينا 3 ثواني
      // بالضبط من لحظة الضغط، وتحت ضغط عالي (عشرات الضغطات بنفس اللحظة) قاعدة
      // البيانات ممكن تتأخر أكثر من كذا، فيفشل التفاعل نهائيًا (Unknown interaction)
      // قبل حتى ما نحاول نرد. الدرس: ACK أول شي دايمًا، وكل شغل ثقيل بعده بـ editReply.
      await interaction.deferReply({ ephemeral: true });

      const period = await queue.getOpenPeriod();
      if (!period) {
        return interaction.editReply({ content: '❌ التفعيل مقفول حاليًا، أو التكتات اكتمل وجاري إنهاء المتبقي.' });
      }

      let issued;
      try {
        issued = await queue.issueTicket({ periodId: period._id, userId: interaction.user.id });
      } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }
      const { ticket, becameFull } = issued;

      try {
        const guild = interaction.guild;
        const overwrites = [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
        ];
        if (STAFF_ROLE_ID) {
          overwrites.push({
            id: STAFF_ROLE_ID,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          });
        }

        // إنشاء الروم يمر عبر طابور متسلسل + إعادة محاولة — عشان لو صار ضغط عالي
        // (عشرات التذاكر بنفس الوقت) ما نصطدم بحد ديسكورد لعدد الرومات المنشأة
        // بفترة قصيرة، وما تضيع تذاكر بدون رومات.
        let ticketChannel;
        try {
          ticketChannel = await enqueue(() =>
            withRetry(
              async () => {
                try {
                  return await guild.channels.create({
                    name: `تفعيل-${ticket.ticketNumber}`,
                    type: ChannelType.GuildText,
                    parent: TICKET_CATEGORY_ID || undefined,
                    permissionOverwrites: overwrites,
                  });
                } catch (e) {
                  // كود 30013 = الكاتيجوري وصلت الحد الأقصى (50 روم) — إعادة المحاولة
                  // ما تفيد بهذا الخطأ تحديدًا (مو مشكلة سرعة/ريت-لمت)، فنوقفها فورًا
                  // برسالة واضحة بدل ما نضيع وقت بـ4 محاولات بلا فايدة.
                  if (e.code === 30013) {
                    const stopErr = new Error('CATEGORY_FULL');
                    stopErr.stopRetrying = true;
                    throw stopErr;
                  }
                  throw e;
                }
              },
              { attempts: 4, baseDelayMs: 2000, label: `إنشاء روم تذكرة #${ticket.ticketNumber}` }
            )
          );
        } catch (channelErr) {
          // فشل نهائي بعد كل المحاولات — نتراجع عن التذكرة كاملة عشان رقمها ما يضل
          // محجوز بدون روم، والعضو يقدر يحاول من جديد فورًا بدل ما يعلق بلا تذكرة ظاهرة.
          console.error(`❌ فشل نهائي بإنشاء روم التذكرة #${ticket.ticketNumber}:`, channelErr.message);
          await queue.rollbackFailedTicket(ticket._id);

          const isCategoryFull = channelErr.message === 'CATEGORY_FULL';
          await interaction.editReply({
            content: isCategoryFull
              ? '❌ كاتيجوري التذاكر وصلت الحد الأقصى لعدد الرومات (50) بديسكورد. تواصل مع الإدارة لتفريغها أو تغييرها — ما تقدر تفتح تذكرة حاليًا.'
              : '❌ صار ضغط عالي وما قدرنا ننشئ روم تذكرتك. اضغط "فتح تذكرة" مرة ثانية الحين — رقمك ما انحجز.',
          });
          if (isCategoryFull) {
            console.error(
              `🚨 كاتيجوري التذاكر (${TICKET_CATEGORY_ID}) وصلت حد الـ50 روم بديسكورد. ` +
                `لازم تحذف رومات تذاكر قديمة أو تشيل TICKET_CATEGORY_ID من المتغيرات.`
            );
          }

          const freshPeriod = await queue.getPeriod(period._id);
          if (freshPeriod) await refreshPanel(interaction.client, freshPeriod);
          return;
        }

        await queue.setTicketChannel(ticket._id, ticketChannel.id);
        const fresh = await queue.getTicket(ticket._id);

        await ticketChannel.send({
          content: `مرحبًا <@${interaction.user.id}>${STAFF_ROLE_ID ? ` — <@&${STAFF_ROLE_ID}>` : ''}`,
          embeds: [buildTicketEmbed(fresh)],
          components: buildTicketButtons(ticket._id, { claimed: false }),
        });

        await interaction.editReply({ content: `✅ تم إنشاء تذكرتك #${ticket.ticketNumber} في ${ticketChannel}.` });

        const freshPeriod = await queue.getPeriod(period._id);
        await refreshPanel(interaction.client, freshPeriod);

        // لو هذي كانت آخر تذكرة أوصلت للحد الأقصى — البانل يتلون أحمر (صار عبر
        // markPeriodFull جوا issueTicket)، وننتظر لين تخلص كل التذاكر أو 15 دقيقة احتياط
        if (becameFull) {
          console.log(`[طابور] ⚠️ فترة #${period._id} اكتملت (${freshPeriod.ticketCount}/${freshPeriod.maxTickets}) — بانتظار إنهاء التذاكر المتبقية.`);
          setTimeout(async () => {
            try {
              const p = await queue.getPeriod(period._id);
              if (p && p.status === 'full') {
                await queue.closePeriod(p._id);
                await deletePanelMessage(interaction.client, p);
                console.log(`[طابور] ⏱️ انتهت مهلة الـ15 دقيقة الاحتياطية — تم إغلاق الفترة #${period._id} وحذف البانل.`);
              }
            } catch (err) {
              console.error('خطأ بمهلة الإنهاء الاحتياطية:', err);
            }
          }, FULL_PERIOD_FAILSAFE_MS);
        }
      } catch (err) {
        console.error(err);
        try {
          await interaction.editReply({ content: '❌ صار خطأ أثناء إنشاء روم التذكرة. تواصل مع الإدارة.' });
        } catch (_) {
          /* تجاهل */
        }
      }
      return;
    }

    // ===== زر: تذكرتي =====
    if (interaction.customId === 'my_ticket') {
      // نفس مبدأ take_ticket: ACK فورًا قبل أي استعلام، لأن هذا الزر كمان معرّض
      // لضغط عالي (عشرات الأعضاء يضغطونه بنفس اللحظة عقب فتح التفعيل مباشرة)
      await interaction.deferReply({ ephemeral: true });

      const period = await queue.getCurrentPeriod();
      if (!period) {
        return interaction.editReply({ content: '❌ لا يوجد تفعيل مفتوح حاليًا.' });
      }
      const ticket = await queue.getUserOpenTicket(period._id, interaction.user.id);
      const ahead = ticket && ticket.status === 'waiting' ? await queue.getPositionInfo(ticket) : 0;
      return interaction.editReply({ embeds: [buildMyTicketEmbed(ticket, ahead)] });
    }

    // ===== زر: حالة الطابور =====
    if (interaction.customId === 'queue_status') {
      await interaction.deferReply({ ephemeral: true });

      const period = await queue.getCurrentPeriod();
      if (!period) {
        return interaction.editReply({ content: '❌ لا يوجد تفعيل مفتوح حاليًا.' });
      }
      const summary = await queue.getQueueSummary(period._id);
      return interaction.editReply({ embeds: [buildQueueStatusEmbed(period, summary)] });
    }

    // ===== زر: استلام (مخصص للإدارة فقط، عملية ذرية بدون أي احتمال تعارض) =====
    if (interaction.customId.startsWith('claim_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ هذا الزر مخصص للإدارة فقط.', ephemeral: true });
      }

      // ACK فورًا (deferUpdate لأن الرد الأصلي هو تعديل نفس الرسالة) قبل أي استعلام
      await interaction.deferUpdate();

      const ticketId = interaction.customId.split('_')[1];

      let ticket;
      try {
        ticket = await queue.claimTicket(ticketId, interaction.user.id);
      } catch (err) {
        if (err.message === 'NOT_FOUND') {
          return interaction.followUp({ content: '❌ لم يتم العثور على هذه التذكرة.', ephemeral: true });
        }
        if (err.message === 'ALREADY_CLAIMED') {
          return interaction.followUp({ content: 'ℹ️ هذه التذكرة تم استلامها بالفعل من إداري آخر.', ephemeral: true });
        }
        if (err.message.startsWith('BLOCKED:')) {
          const num = err.message.split(':')[1];
          return interaction.followUp({
            content: `⏳ لسا ما وصل دور هذه التذكرة. لازم تُستلم التذكرة **#${num}** أولًا.`,
            ephemeral: true,
          });
        }
        console.error(err);
        return interaction.followUp({ content: '❌ صار خطأ غير متوقع.', ephemeral: true });
      }

      await interaction.editReply({
        embeds: [buildTicketEmbed(ticket)],
        components: buildTicketButtons(ticketId, { claimed: true }),
      });

      await interaction.followUp({
        content: `✅ تم استلام التذكرة بواسطة <@${interaction.user.id}>.`,
      });

      // تحديث إحصائية الاستلام بقاعدة بيانات البوت الثاني (الفئة: تفعيل)
      await incrementClaimStat(interaction.user.id);

      const period = await queue.getPeriod(ticket.periodId);
      await refreshPanel(interaction.client, period);
      return;
    }

    // ===== زر: إغلاق — مخصص للإدارة فقط، ويفتح مودال لكتابة سبب إلزامي =====
    if (interaction.customId.startsWith('close_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ إغلاق التذكرة مخصص للإدارة فقط.', ephemeral: true });
      }

      const ticketId = interaction.customId.split('_')[1];
      const ticket = await queue.getTicket(ticketId);
      if (!ticket) return interaction.reply({ content: '❌ لم يتم العثور على هذه التذكرة.', ephemeral: true });
      if (ticket.status === 'closed') {
        return interaction.reply({ content: 'ℹ️ هذه التذكرة مغلقة بالفعل.', ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`close_reason_${ticketId}`)
        .setTitle(`إغلاق التذكرة #${ticket.ticketNumber}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('سبب الإغلاق')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(500)
        .setPlaceholder('اكتب سبب إغلاق هذه التذكرة...');

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      await interaction.showModal(modal);
      return;
    }

    // ===== زر: استدعاء — مخصص للإدارة فقط =====
    if (interaction.customId.startsWith('summon_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ هذا الزر مخصص للإدارة فقط.', ephemeral: true });
      }

      // ACK فورًا قبل أي استعلام (استلام/إغلاق/استدعاء إدارية مو بزحمة 30 شخص،
      // لكن نحافظ على نفس المبدأ بكل مكان احتياطًا)
      await interaction.deferReply();

      const ticketId = interaction.customId.split('_')[1];
      const ticket = await queue.getTicket(ticketId);
      if (!ticket) return interaction.editReply({ content: '❌ لم يتم العثور على هذه التذكرة.' });
      if (ticket.status === 'closed') {
        return interaction.editReply({ content: 'ℹ️ هذه التذكرة مغلقة بالفعل.' });
      }

      const snapshot = await queue.setSummoned(ticketId, interaction.user.id);

      try {
        const member = await interaction.guild.members.fetch(ticket.userId);
        await member.send(
          `🔔 **تم استدعاؤك من الإدارة**\n` +
            `يرجى الرد داخل تذكرتك رقم **#${ticket.ticketNumber}** خلال **10 دقائق**، ` +
            `وإلا سيتم إغلاق التذكرة تلقائيًا.\n` +
            (ticket.channelId ? `الروم: <#${ticket.channelId}>` : '')
        );
        await interaction.editReply({ content: `🔔 تم إرسال استدعاء لصاحب التذكرة، أمامه 10 دقائق للرد.` });
      } catch (err) {
        console.error('تعذر إرسال رسالة الاستدعاء الخاصة:', err.message);
        await interaction.editReply({
          content: `⚠️ تم تسجيل الاستدعاء (10 دقائق)، لكن ما قدرت أرسل له رسالة خاصة (يمكن مقفل الخاص).`,
        });
      }

      setTimeout(async () => {
        try {
          const stillPending = await queue.isSummonStillPending(ticketId, snapshot);
          if (!stillPending) return; // رد العضو أو انسحب الاستدعاء

          await performTicketClose({
            client: interaction.client,
            guild: interaction.guild,
            ticketId,
            staffId: interaction.client.user.id,
            reason: 'إغلاق تلقائي - لم يرد العضو خلال مهلة الاستدعاء (10 دقائق)',
          });
          console.log(`[استدعاء] 🔒 تم إغلاق التذكرة #${ticketId} تلقائيًا (لا رد خلال المهلة).`);
        } catch (err) {
          if (err.message !== 'ALREADY_CLOSED') console.error('خطأ أثناء الإغلاق التلقائي بعد الاستدعاء:', err);
        }
      }, SUMMON_TIMEOUT_MS);
      return;
    }
  },
};
