const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI غير معرّف بمتغيرات البيئة. البوت ما يقدر يشتغل بدونه.');
  process.exit(1);
}

mongoose.connection.on('connected', () => {
  console.log(`📦 متصل بقاعدة البيانات (MongoDB): ${mongoose.connection.name}`);
});
mongoose.connection.on('error', (err) => {
  console.error('❌ خطأ اتصال MongoDB:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ انقطع الاتصال بقاعدة البيانات — mongoose بيحاول يعيد الاتصال تلقائيًا.');
});

mongoose.connect(MONGODB_URI).catch((err) => {
  console.error('❌ فشل الاتصال الأولي بقاعدة البيانات:', err.message);
  process.exit(1);
});

module.exports = mongoose;
