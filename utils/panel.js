const queue = require('./queue');
const { buildPanelEmbed } = require('./embeds');

/** يحدّث رسالة البانل بالعداد الحالي */
async function refreshPanel(client, period) {
  try {
    if (!period.panel_message_id) return;
    const channel = await client.channels.fetch(period.channel_id);
    const msg = await channel.messages.fetch(period.panel_message_id);
    const fresh = queue.getPeriod(period.id);
    await msg.edit({ embeds: [buildPanelEmbed(fresh)] });
  } catch (err) {
    console.error('تعذر تحديث البانل:', err.message);
  }
}

/**
 * يحذف رسالة بانل التفعيل من الروم (تُستخدم عند اكتمال العدد أو الإغلاق اليدوي)
 * ثم يمسح panel_message_id من قاعدة البيانات حتى لا نحاول حذفها مرة ثانية.
 */
async function deletePanelMessage(client, period) {
  if (!period.panel_message_id) return;
  try {
    const channel = await client.channels.fetch(period.channel_id);
    const msg = await channel.messages.fetch(period.panel_message_id);
    await msg.delete();
  } catch (err) {
    console.error('تعذر حذف بانل التفعيل:', err.message);
  } finally {
    queue.setPanelMessage(period.id, null);
  }
}

module.exports = { refreshPanel, deletePanelMessage };
