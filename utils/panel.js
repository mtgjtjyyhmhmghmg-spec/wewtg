const queue = require('./queue');
const { buildPanelEmbed } = require('./embeds');

/** يحدّث رسالة البانل بالعداد الحالي */
async function refreshPanel(client, period) {
  try {
    if (!period.panelMessageId) return;
    const channel = await client.channels.fetch(period.channelId);
    const msg = await channel.messages.fetch(period.panelMessageId);
    const fresh = await queue.getPeriod(period._id);
    const summary = await queue.getQueueSummary(fresh._id);
    await msg.edit({ embeds: [buildPanelEmbed(fresh, summary)] });
  } catch (err) {
    console.error('تعذر تحديث البانل:', err.message);
  }
}

/**
 * يحذف رسالة بانل التفعيل + رسالة العد التنازلي (5 ثواني) من الروم، ثم يمسح
 * معرفاتهم من قاعدة البيانات حتى لا نحاول حذفهم مرة ثانية.
 */
async function deletePanelMessage(client, period) {
  try {
    const channel = await client.channels.fetch(period.channelId);

    if (period.panelMessageId) {
      try {
        const msg = await channel.messages.fetch(period.panelMessageId);
        await msg.delete();
      } catch (err) {
        console.error('تعذر حذف بانل التفعيل:', err.message);
      }
    }

    if (period.countdownMessageId) {
      try {
        const msg = await channel.messages.fetch(period.countdownMessageId);
        await msg.delete();
      } catch (err) {
        console.error('تعذر حذف رسالة العد التنازلي:', err.message);
      }
    }
  } finally {
    await queue.setPanelMessage(period._id, null);
    await queue.setCountdownMessage(period._id, null);
  }
}

/**
 * يُستدعى بعد إغلاق أي تذكرة — لو الفترة صارت "full" وخلصت كل التذاكر
 * (ما بقي منها waiting ولا claimed)، يقفل الفترة نهائيًا ويحذف البانل.
 */
async function finalizePeriodIfDone(client, periodId) {
  const period = await queue.getPeriod(periodId);
  if (!period || period.status !== 'full') return;

  const remaining = await queue.countOpenTickets(periodId);
  if (remaining === 0) {
    await queue.closePeriod(periodId);
    await deletePanelMessage(client, period);
    console.log(`[طابور] ✅ فترة #${periodId} خلصت كل تذاكرها — تم إغلاقها وحذف البانل.`);
  }
}

module.exports = { refreshPanel, deletePanelMessage, finalizePeriodIfDone };
