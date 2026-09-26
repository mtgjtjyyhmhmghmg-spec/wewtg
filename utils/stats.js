const mongoose = require('mongoose');

const STATS_TICKET_TYPE_KEY = process.env.STATS_TICKET_TYPE_KEY || 'تفعيل';
const STATS_COLLECTION_NAME = process.env.STATS_COLLECTION_NAME || 'users';

let externalConnection = null;

function isValidMongoUri(uri) {
  return typeof uri === 'string' && (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'));
}

/** يرجع الكولكشن الصحيح: قاعدة/كلستر منفصل لو محدد وصحيح، وإلا نفس اتصال البوت الأساسي */
function getStatsCollection() {
  const externalUri = process.env.STATS_MONGODB_URI;

  if (externalUri) {
    if (!isValidMongoUri(externalUri)) {
      console.warn(
        `⚠️ STATS_MONGODB_URI موجود بمتغيرات البيئة لكن صيغته غلط (يجب أن يبدأ بـ mongodb:// أو mongodb+srv://). ` +
          `تجاهلته واستخدم اتصال قاعدة البيانات الأساسي بدله — احذف هذا المتغير لو ما تحتاجه.`
      );
    } else {
      if (!externalConnection) {
        externalConnection = mongoose.createConnection(externalUri);
        // نمسك أي خطأ اتصال هنا حتى لا يتحول إلى unhandledRejection يوقف البوت بالكامل
        externalConnection.on('error', (err) => {
          console.error('⚠️ خطأ اتصال STATS_MONGODB_URI:', err.message);
        });
      }
      return externalConnection.collection(STATS_COLLECTION_NAME);
    }
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
      { upsert: true, maxTimeMS: 5000 }
    );
  } catch (err) {
    console.error('⚠️ تعذر تحديث إحصائية الاستلام بقاعدة البيانات الخارجية:', err.message);
  }
}

module.exports = { incrementClaimStat };
