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

const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const SUMMON_TIMEOUT_MS = 10 * 60 * 1000; // 10 دقائق

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
      const ticketId = Number(interaction.customId.split('_')[2]);
      const reason = interaction.fields.getTextInputValue('reason').trim();

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
          return interaction.reply({ content: 'ℹ️ هذه التذكرة مغلقة بالفعل.', ephemeral: true });
        }
        console.error(err);
        return interaction.reply({ content: '❌ صار خطأ أثناء الإغلاق.', ephemeral: true });
      }

      await interaction.reply({ content: `🔒 تم إغلاق التذكرة #${ticket.ticket_number}.`, ephemeral: true });
      return;
    }

    if (!interaction.isButton()) return;

    // ===== زر: فتح تذكرة =====
    if (interaction.customId === 'take_ticket') {
      const period = queue.getOpenPeriod();
      if (!period) {
        return interaction.reply({ content: '❌ التفعيل مقفول حاليًا.', ephemeral: true });
      }

      let ticket;
      try {
        ticket = queue.issueTicket({ periodId: period.id, userId: interaction.user.id });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

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

        const ticketChannel = await guild.channels.create({
          name: `تفعيل-${ticket.ticket_number}`,
          type: ChannelType.GuildText,
          parent: TICKET_CATEGORY_ID || undefined,
          permissionOverwrites: overwrites,
        });

        queue.setTicketChannel(ticket.id, ticketChannel.id);
        const fresh = queue.getTicket(ticket.id);

        await ticketChannel.send({
          content: `مرحبًا <@${interaction.user.id}>${STAFF_ROLE_ID ? ` — <@&${STAFF_ROLE_ID}>` : ''}`,
          embeds: [buildTicketEmbed(fresh)],
          components: buildTicketButtons(ticket.id, { claimed: false }),
        });

        await interaction.editReply({ content: `✅ تم إنشاء تذكرتك #${ticket.ticket_number} في ${ticketChannel}.` });

        // لو هذي كانت آخر تذكرة متاحة (وصلنا الحد الأقصى) — نقفل الفترة تلقائيًا
        // ونحذف بانل التفعيل بالكامل من الروم (خلاص قفل)
        const freshPeriod = queue.getPeriod(period.id);
        if (freshPeriod.ticket_count >= freshPeriod.max_tickets) {
          queue.closePeriod(period.id);
          await deletePanelMessage(interaction.client, freshPeriod);
          console.log(`[طابور] 🔒 فترة #${period.id} اكتملت (${freshPeriod.ticket_count}/${freshPeriod.max_tickets}) — تم إغلاقها وحذف البانل تلقائيًا.`);
        } else {
          await refreshPanel(interaction.client, freshPeriod);
        }
      } catch (err) {
        console.error(err);
        await interaction.editReply({ content: '❌ صار خطأ أثناء إنشاء روم التذكرة. تواصل مع الإدارة.' });
      }
      return;
    }

    // ===== زر: تذكرتي =====
    if (interaction.customId === 'my_ticket') {
      const period = queue.getOpenPeriod();
      if (!period) {
        return interaction.reply({ content: '❌ لا يوجد تفعيل مفتوح حاليًا.', ephemeral: true });
      }
      const ticket = queue.getUserOpenTicket(period.id, interaction.user.id);
      return interaction.reply({ embeds: [buildMyTicketEmbed(ticket)], ephemeral: true });
    }

    // ===== زر: حالة الطابور =====
    if (interaction.customId === 'queue_status') {
      const period = queue.getOpenPeriod();
      if (!period) {
        return interaction.reply({ content: '❌ لا يوجد تفعيل مفتوح حاليًا.', ephemeral: true });
      }
      return interaction.reply({ embeds: [buildQueueStatusEmbed(period)], ephemeral: true });
    }

    // ===== زر: استلام (مخصص للإدارة فقط، عملية ذرية بدون أي احتمال تعارض) =====
    if (interaction.customId.startsWith('claim_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ هذا الزر مخصص للإدارة فقط.', ephemeral: true });
      }

      const ticketId = Number(interaction.customId.split('_')[1]);

      let ticket;
      try {
        // فحص الترتيب + التحديث يصيران معًا كوحدة واحدة غير قابلة للمقاطعة (transaction).
        // مستحيل يستلم إداريان نفس التذكرة أو يتجاوزون الترتيب حتى لو ضغطوا بنفس اللحظة.
        ticket = queue.claimTicket(ticketId, interaction.user.id);
      } catch (err) {
        if (err.message === 'NOT_FOUND') {
          return interaction.reply({ content: '❌ لم يتم العثور على هذه التذكرة.', ephemeral: true });
        }
        if (err.message === 'ALREADY_CLAIMED') {
          return interaction.reply({ content: 'ℹ️ هذه التذكرة تم استلامها بالفعل من إداري آخر.', ephemeral: true });
        }
        if (err.message.startsWith('BLOCKED:')) {
          const num = err.message.split(':')[1];
          return interaction.reply({
            content: `⏳ لسا ما وصل دور هذه التذكرة. لازم تُستلم التذكرة **#${num}** أولًا.`,
            ephemeral: true,
          });
        }
        console.error(err);
        return interaction.reply({ content: '❌ صار خطأ غير متوقع.', ephemeral: true });
      }

      await interaction.update({
        embeds: [buildTicketEmbed(ticket)],
        components: buildTicketButtons(ticketId, { claimed: true }),
      });

      await interaction.followUp({
        content: `✅ تم استلام التذكرة بواسطة <@${interaction.user.id}>.`,
      });

      const period = queue.getPeriod(ticket.period_id);
      await refreshPanel(interaction.client, period);
      return;
    }

    // ===== زر: إغلاق — مخصص للإدارة فقط، ويفتح مودال لكتابة سبب إلزامي =====
    if (interaction.customId.startsWith('close_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ إغلاق التذكرة مخصص للإدارة فقط.', ephemeral: true });
      }

      const ticketId = Number(interaction.customId.split('_')[1]);
      const ticket = queue.getTicket(ticketId);
      if (!ticket) return interaction.reply({ content: '❌ لم يتم العثور على هذه التذكرة.', ephemeral: true });
      if (ticket.status === 'closed') {
        return interaction.reply({ content: 'ℹ️ هذه التذكرة مغلقة بالفعل.', ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`close_reason_${ticketId}`)
        .setTitle(`إغلاق التذكرة #${ticket.ticket_number}`);

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

      const ticketId = Number(interaction.customId.split('_')[1]);
      const ticket = queue.getTicket(ticketId);
      if (!ticket) return interaction.reply({ content: '❌ لم يتم العثور على هذه التذكرة.', ephemeral: true });
      if (ticket.status === 'closed') {
        return interaction.reply({ content: 'ℹ️ هذه التذكرة مغلقة بالفعل.', ephemeral: true });
      }

      const snapshot = queue.setSummoned(ticketId, interaction.user.id);

      try {
        const member = await interaction.guild.members.fetch(ticket.user_id);
        await member.send(
          `🔔 **تم استدعاؤك من الإدارة**\n` +
            `يرجى الرد داخل تذكرتك رقم **#${ticket.ticket_number}** خلال **10 دقائق**، ` +
            `وإلا سيتم إغلاق التذكرة تلقائيًا.\n` +
            (ticket.channel_id ? `الروم: <#${ticket.channel_id}>` : '')
        );
        await interaction.reply({ content: `🔔 تم إرسال استدعاء لصاحب التذكرة، أمامه 10 دقائق للرد.` });
      } catch (err) {
        console.error('تعذر إرسال رسالة الاستدعاء الخاصة:', err.message);
        await interaction.reply({
          content: `⚠️ تم تسجيل الاستدعاء (10 دقائق)، لكن ما قدرت أرسل له رسالة خاصة (يمكن مقفل الخاص).`,
        });
      }

      // بعد 10 دقايق: لو ما رد العضو (ولا صار استدعاء أحدث) نقفل التذكرة تلقائيًا
      setTimeout(async () => {
        try {
          if (!queue.isSummonStillPending(ticketId, snapshot)) return; // رد العضو أو انسحب الاستدعاء

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
