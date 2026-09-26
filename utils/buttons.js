const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('take_ticket').setLabel('فتح تذكرة').setEmoji('🎫').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('my_ticket').setLabel('تذكرتي').setEmoji('📋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('queue_status').setLabel('حالة الطابور').setEmoji('📊').setStyle(ButtonStyle.Secondary)
  );
}

function buildTicketButtons(ticketId, { claimed }) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${ticketId}`)
      .setLabel('استلام')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!!claimed),
    new ButtonBuilder().setCustomId(`close_${ticketId}`).setLabel('إغلاق').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`summon_${ticketId}`).setLabel('استدعاء').setEmoji('🔔').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2];
}

module.exports = { buildPanelButtons, buildTicketButtons };
