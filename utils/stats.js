const mongoose = require('mongoose');

const STATS_TICKET_TYPE_KEY = process.env.STATS_TICKET_TYPE_KEY || 'تفعيل';
const STATS_COLLECTION_NAME = process.env.STATS_COLLECTION_NAME || 'users';

let externalConnection = null;

/** يرجع الكولكشن الصحيح: قاعدة/كلستر منفصل لو محدد، وإلا نفس اتصال البوت الأساسي */
function getStatsCollection() {
  if (process.env.STATS_MONGODB_URI) {
    if (!externalConnection) {
      externalConnection = mongoose.createConnection(process.env.STATS_MONGODB_URI);
    }
    return externalConnection.collection(STATS_COLLECTION_NAME);
  }
  const conn = process.env.STATS_DB_NAME ? mongoose.connection.useDb(process.env.STATS_DB_NAME) : mongoose.connection;
  return conn.collection(STATS_COLLECTION_NAME);
}

/**
 * يزيد عداد التذاكر المستلمة لهذا الإداري بقاعدة بيانات البوت الثاني —
 * نفس فكرة: User.updateOne({discordId}, {$inc: {[`ticketsClaimed.${typeKey}`]: 1}}, {upsert:true})
 */
async function incrementClaimStat(discordId) {
  try {
    const collection = getStatsCollection();
    await collection.updateOne(
      { discordId },
      { $inc: { [`ticketsClaimed.${STATS_TICKET_TYPE_KEY}`]: 1 } },
      { upsert: true }
    );
  } catch (err) {
    console.error('⚠️ تعذر تحديث إحصائية الاستلام بقاعدة البيانات الخارجية:', err.message);
  }
}

module.exports = { incrementClaimStat };
