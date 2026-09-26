const { EmbedBuilder } = require('discord.js');

/** إمبد بانل فتح التفعيل (يتحدث تلقائيًا كل ما تصدر تذكرة). summary يُجلب مسبقًا بالمستدعي. */
function buildPanelEmbed(period, summary) {
  const isOpen = period.status === 'open';
  const isFull = period.status === 'full';

  let footerText = 'الطابور مفتوح';
  if (isFull) footerText = '⚠️ اكتمل العدد — جاري إنهاء التذاكر المتبقية';
  else if (period.status === 'closed') footerText = 'الطابور مغلق';

  return new EmbedBuilder()
    .setTitle('🎫 تم افتتاح التفعيل')
    .setDescription(
      'قم بفتح تذكرة و سيتواصل معك طاقم التفعيل لخدمتك\n\n' +
        '- **تذكرتي**: مخصص لمعرفة رقمك وترتيبك\n' +
        '- **حالة الطابور**: مخصص لمعرفة الوضع العام للتفعيل\n\n' +
        'نسعى لخدمتكم دائما وولف بالقمة ☝🏻🟣'
    )
    .addFields(
      { name: 'التذاكر الحالية', value: `${summary.total} / ${period.maxTickets}`, inline: true },
      { name: 'قيد الانتظار', value: `${summary.waiting}`, inline: true },
      { name: 'قيد المعالجة', value: `${summary.claimed}`, inline: true },
      { name: 'مكتملة', value: `${summary.closed}`, inline: true }
    )
    .setColor(isOpen ? 0x57f287 : 0xed4245)
    .setFooter({ text: footerText })
    .setTimestamp();
}

/** إمبد داخل روم التكت الخاص بالعضو. ahead يُجلب مسبقًا بالمستدعي. */
function buildTicketEmbed(ticket, ahead = 0) {
  const statusMap = {
    waiting: '🟡 بالانتظار',
    claimed: '🔵 قيد المعالجة',
    closed: '🟢 مكتملة',
  };
  return new EmbedBuilder()
    .setTitle(`تذكرة #${ticket.ticketNumber}`)
    .addFields(
      { name: 'العضو', value: `<@${ticket.userId}>`, inline: true },
      { name: 'الحالة', value: statusMap[ticket.status], inline: true },
      { name: 'المتبقي قدامك', value: ticket.status === 'waiting' ? `${ahead}` : '—', inline: true }
    )
    .setColor(0x5865f2)
    .setTimestamp();
}

/** رد مخفي لزر "تذكرتي". ahead يُجلب مسبقًا بالمستدعي لو التذكرة waiting. */
function buildMyTicketEmbed(ticket, ahead = 0) {
  if (!ticket) {
    return new EmbedBuilder().setDescription('❌ لا يوجد لديك تكت مفتوح.').setColor(0xed4245);
  }
  const statusMap = {
    waiting: '🟡 بالانتظار',
    claimed: '🔵 قيد المعالجة حاليًا',
    closed: '🟢 مكتملة',
  };
  return new EmbedBuilder()
    .setTitle(`🎫 تذكرتك #${ticket.ticketNumber}`)
    .addFields(
      { name: 'الحالة', value: statusMap[ticket.status], inline: true },
      { name: 'أمامك', value: ticket.status === 'waiting' ? `${ahead} شخص` : '—', inline: true },
      { name: 'الروم', value: ticket.channelId ? `<#${ticket.channelId}>` : '—', inline: true }
    )
    .setColor(0x5865f2);
}

/** رد مخفي لزر "حالة الطابور". summary يُجلب مسبقًا بالمستدعي. */
function buildQueueStatusEmbed(period, summary) {
  return new EmbedBuilder()
    .setTitle('📊 حالة الطابور')
    .addFields(
      { name: 'الإجمالي', value: `${summary.total} / ${period.maxTickets}`, inline: true },
      { name: 'بالانتظار', value: `${summary.waiting}`, inline: true },
      { name: 'قيد المعالجة', value: `${summary.claimed}`, inline: true },
      { name: 'مكتملة', value: `${summary.closed}`, inline: true }
    )
    .setColor(0x5865f2);
}

/** إمبد اللوق يُرسل بروم اللوقات + بالخاص لصاحب التذكرة عند إغلاق أي تكت */
function buildTicketLogEmbed(ticket) {
  const fmt = (d) => (d ? `<t:${Math.floor(new Date(d).getTime() / 1000)}:F>` : '—');
  return new EmbedBuilder()
    .setTitle(`📁 سجل التذكرة #${ticket.ticketNumber}`)
    .addFields(
      { name: 'فتحها', value: `<@${ticket.userId}>`, inline: true },
      { name: 'وقت الفتح', value: fmt(ticket.openedAt), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'استلمها', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '— لم تُستلم —', inline: true },
      { name: 'وقت الاستلام', value: fmt(ticket.claimedAt), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'أغلقها', value: `<@${ticket.closedBy}>`, inline: true },
      { name: 'وقت الإغلاق', value: fmt(ticket.closedAt), inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'سبب الإغلاق', value: ticket.closeReason || '—', inline: false }
    )
    .setColor(0xed4245)
    .setTimestamp();
}

/** محتوى ملف نصي قابل للتحميل يوثّق كل تفاصيل التذكرة + ترانزكريبت كامل للرسائل */
function buildTicketLogFileContent(ticket) {
  const lines = [
    `سجل التذكرة #${ticket.ticketNumber}`,
    '='.repeat(30),
    `معرف التذكرة الداخلي: ${ticket._id}`,
    `معرف الفترة: ${ticket.periodId}`,
    '',
    `فتحها: ${ticket.userId}`,
    `وقت الفتح: ${ticket.openedAt ? ticket.openedAt.toISOString() : '—'}`,
    '',
    `استلمها: ${ticket.claimedBy || '— لم تُستلم —'}`,
    `وقت الاستلام: ${ticket.claimedAt ? ticket.claimedAt.toISOString() : '—'}`,
    '',
    `أغلقها: ${ticket.closedBy}`,
    `وقت الإغلاق: ${ticket.closedAt ? ticket.closedAt.toISOString() : '—'}`,
    '',
    'سبب الإغلاق:',
    ticket.closeReason || '—',
    '',
    '='.repeat(30),
    'ترانزكريبت الرسائل داخل التذكرة:',
    '='.repeat(30),
  ];

  if (!ticket.messages || ticket.messages.length === 0) {
    lines.push('(ما فيه رسائل مسجّلة)');
  } else {
    for (const m of ticket.messages) {
      const time = m.createdAt ? new Date(m.createdAt).toISOString() : '—';
      lines.push(`[${time}] ${m.authorTag || m.authorId}: ${m.content || '(بدون نص / مرفق)'}`);
    }
  }

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
