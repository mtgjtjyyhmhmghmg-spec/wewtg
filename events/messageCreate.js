const queue = require('../utils/queue');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;

    const ticket = queue.getTicketByChannel(message.channel.id);
    if (!ticket) return;
    if (ticket.status === 'closed') return;
    if (message.author.id !== ticket.user_id) return;
    if (!ticket.summoned_at) return;

    queue.clearSummon(ticket.id);
    try {
      await message.channel.send('✅ تم استلام ردك، تم إلغاء الاستدعاء.');
    } catch (_) {
      /* تجاهل */
    }
  },
};
