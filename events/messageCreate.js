const queue = require('../utils/queue');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;

    const ticket = await queue.getTicketByChannel(message.channel.id);
    if (!ticket) return;
    if (ticket.status === 'closed') return;

    // تسجيل الرسالة بترانزكريبت التذكرة (يُستخدم بملف اللوق عند الإغلاق)
    await queue.appendTicketMessage(ticket._id, {
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content,
    });

    // إلغاء الاستدعاء لو صاحب التذكرة هو اللي رد
    if (message.author.id === ticket.userId && ticket.summonedAt) {
      await queue.clearSummon(ticket._id);
      try {
        await message.channel.send('✅ تم استلام ردك، تم إلغاء الاستدعاء.');
      } catch (_) {
        /* تجاهل */
      }
    }
  },
};
