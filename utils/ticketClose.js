const { AttachmentBuilder } = require('discord.js');
const queue = require('./queue');
const { buildTicketEmbed, buildTicketLogEmbed, buildTicketLogFileContent } = require('./embeds');
const { refreshPanel, finalizePeriodIfDone } = require('./panel');

const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID;

/**
 * خط أنابيب موحّد لإغلاق أي تذكرة — يُستخدم سواء الإغلاق كان يدوي (عبر المودال)
 * أو تلقائي (عدم رد العضو على الاستدعاء خلال المهلة). يسوي كل شي بمكان واحد:
 * تحديث قاعدة البيانات، إرسال رسالة بالتكت، اللوق + الملف + الخاص لصاحب التكت،
 * تحديث البانل (أو إنهاء الفترة لو خلصت كل تذاكرها بعد الاكتمال)، وحذف روم التكت.
 */
async function performTicketClose({ client, guild, ticketId, staffId, reason }) {
  const ticket = await queue.closeTicket(ticketId, staffId, reason);

  // رسالة بروم التكت نفسه
  try {
    if (ticket.channelId) {
      const ticketChannel = await client.channels.fetch(ticket.channelId);
      await ticketChannel.send({ embeds: [buildTicketEmbed(ticket)] });
    }
  } catch (err) {
    console.error('تعذر إرسال رسالة الإغلاق بروم التكت:', err.message);
  }

  // تحديث البانل أو إنهاء الفترة لو كانت "full" وخلصت كل تذاكرها
  const period = await queue.getPeriod(ticket.periodId);
  if (period) {
    await finalizePeriodIfDone(client, period._id);
    const stillOpen = await queue.getPeriod(period._id);
    if (stillOpen && stillOpen.status !== 'closed') {
      await refreshPanel(client, stillOpen);
    }
  }

  // بناء ملف اللوق مرة وحدة (فيه ترانزكريبت الرسائل)، نستخدمه للوق وللخاص
  const fileContent = buildTicketLogFileContent(ticket);
  const logEmbed = buildTicketLogEmbed(ticket);

  // اللوق بروم مخصص
  if (TICKET_LOG_CHANNEL_ID) {
    try {
      const logChannel = await client.channels.fetch(TICKET_LOG_CHANNEL_ID);
      const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf-8'), {
        name: `تذكرة-${ticket.ticketNumber}.txt`,
      });
      await logChannel.send({ embeds: [logEmbed], files: [attachment] });
    } catch (err) {
      console.error('تعذر إرسال اللوق:', err.message);
    }
  }

  // نفس محتوى اللوق يُرسل بالخاص لصاحب التذكرة
  try {
    const owner = await client.users.fetch(ticket.userId);
    const dmAttachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf-8'), {
      name: `تذكرة-${ticket.ticketNumber}.txt`,
    });
    await owner.send({
      content: `تم إغلاق تذكرتك #${ticket.ticketNumber}.`,
      embeds: [logEmbed],
      files: [dmAttachment],
    });
  } catch (err) {
    console.error('تعذر إرسال رسالة خاصة لصاحب التذكرة (قد يكون مغلق الخاص):', err.message);
  }

  // حذف روم التكت بعد تأخير بسيط
  setTimeout(async () => {
    try {
      if (ticket.channelId) {
        const channel = await guild.channels.fetch(ticket.channelId);
        await channel.delete('تم إغلاق التذكرة');
      }
    } catch (_) {
      /* الروم محذوف مسبقًا أو لا صلاحية */
    }
  }, 5000);

  return ticket;
}

module.exports = { performTicketClose };
