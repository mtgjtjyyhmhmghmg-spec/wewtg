const { EmbedBuilder } = require('discord.js');
const queue = require('./queue');

/** إمبد بانل فتح التفعيل (يتحدث تلقائيًا كل ما تصدر تذكرة) */
function buildPanelEmbed(period) {
  const summary = queue.getQueueSummary(period.id);
  return new EmbedBuilder()
    .setTitle('🎫 تم افتتاح التفعيل')
    .setDescription(
      'قم بفتح تذكرة و سيتواصل معك طاقم التفعيل لخدمتك\n\n' +
        '- **تذكرتي**: مخصص لمعرفة رقمك وترتيبك\n' +
        '- **حالة الطابور**: مخصص لمعرفة الوضع العام للتفعيل\n\n' +
        'نسعى لخدمتكم دائما وولف بالقمة ☝🏻🟣'
    )
    .addFields(
      { name: 'التذاكر الحالية', value: `${summary.total} / ${period.max_tickets}`, inline: true },
      { name: 'قيد الانتظار', value: `${summary.waiting}`, inline: true },
      { name: 'قيد المعالجة', value: `${summary.claimed}`, inline: true },
      { name: 'مكتملة', value: `${summary.closed}`, inline: true }
    )
    .setColor(period.status === 'open' ? 0x57f287 : 0xed4245)
    .setFooter({ text: period.status === 'open' ? 'الطابور مفتوح' : 'الطابور مغلق' })
    .setTimestamp();
}

/** إمبد داخل روم التكت الخاص بالعضو */
function buildTicketEmbed(ticket) {
  const ahead = queue.getPositionInfo(ticket);
  const statusMap = {
    waiting: '🟡 بالانتظار',
    claimed: '🔵 قيد المعالجة',
    closed: '🟢 مكتملة',
  };
  return new EmbedBuilder()
    .setTitle(`تذكرة #${ticket.ticket_number}`)
    .addFields(
      { name: 'العضو', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'الحالة', value: statusMap[ticket.status], inline: true },
      { name: 'المتبقي قدامك', value: ticket.status === 'waiting' ? `${ahead}` : '—', inline: true }
    )
    .setColor(0x5865f2)
    .setTimestamp();
}

/** رد مخفي لأمر "تذكرتي" */
function buildMyTicketEmbed(ticket) {
  if (!ticket) {
    return new EmbedBuilder().setDescription('❌ لا يوجد لديك تكت مفتوح.').setColor(0xed4245);
  }
  const ahead = queue.getPositionInfo(ticket);
  const statusMap = {
    waiting: '🟡 بالانتظار',
    claimed: '🔵 قيد المعالجة حاليًا',
    closed: '🟢 مكتملة',
  };
  return new EmbedBuilder()
    .setTitle(`🎫 تذكرتك #${ticket.ticket_number}`)
    .addFields(
      { name: 'الحالة', value: statusMap[ticket.status], inline: true },
      { name: 'أمامك', value: ticket.status === 'waiting' ? `${ahead} شخص` : '—', inline: true },
      { name: 'الروم', value: ticket.channel_id ? `<#${ticket.channel_id}>` : '—', inline: true }
    )
    .setColor(0x5865f2);
}

/** رد مخفي لأمر "حالة الطابور" */
function buildQueueStatusEmbed(period) {
  const summary = queue.getQueueSummary(period.id);
  return new EmbedBuilder()
    .setTitle('📊 حالة الطابور')
    .addFields(
      { name: 'الإجمالي', value: `${summary.total} / ${period.max_tickets}`, inline: true },
      { name: 'بالانتظار', value: `${summary.waiting}`, inline: true },
      { name: 'قيد المعالجة', value: `${summary.claimed}`, inline: true },
      { name: 'مكتملة', value: `${summary.closed}`, inline: true }
    )
    .setColor(0x5865f2);
}

/** إمبد اللوق يُرسل بروم اللوقات عند إغلاق أي تكت */
function buildTicketLogEmbed(ticket) {
  const fmt = (iso) => (iso ? `<t:${Math.floor(new Date(iso + 'Z').getTime() / 1000)}:F>` : '—');
  return new EmbedBuilder()
    .setTitle(`📁 سجل التذكرة #${ticket.ticket_number}`)
    .addFields(
      { name: 'فتحها', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'وقت الفتح', value: fmt(ticket.opened_at), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'استلمها', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : '— لم تُستلم —', inline: true },
      { name: 'وقت الاستلام', value: fmt(ticket.claimed_at), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'أغلقها', value: `<@${ticket.closed_by}>`, inline: true },
      { name: 'وقت الإغلاق', value: fmt(ticket.closed_at), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'سبب الإغلاق', value: ticket.close_reason || '—', inline: false }
    )
    .setColor(0xed4245)
    .setTimestamp();
}

/** محتوى ملف نصي قابل للتحميل يوثّق كل ما صار بالتذكرة (يُرفق مع رسالة اللوق) */
function buildTicketLogFileContent(ticket) {
  const lines = [
    `سجل التذكرة #${ticket.ticket_number}`,
    '='.repeat(30),
    `رقم التذكرة: ${ticket.ticket_number}`,
    `معرف التذكرة الداخلي: ${ticket.id}`,
    `معرف الفترة: ${ticket.period_id}`,
    '',
    `فتحها: ${ticket.user_id}`,
    `وقت الفتح: ${ticket.opened_at} (UTC)`,
    '',
    `استلمها: ${ticket.claimed_by || '— لم تُستلم —'}`,
    `وقت الاستلام: ${ticket.claimed_at || '—'} (UTC)`,
    '',
    `أغلقها: ${ticket.closed_by}`,
    `وقت الإغلاق: ${ticket.closed_at} (UTC)`,
    '',
    'سبب الإغلاق:',
    ticket.close_reason || '—',
  ];
  return lines.join('\n');
}

module.exports = {
  buildPanelEmbed,
  buildTicketEmbed,
  buildMyTicketEmbed,
  buildQueueStatusEmbed,
  buildTicketLogEmbed,
  buildTicketLogFileContent,
};
