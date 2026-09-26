const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  dayOfWeek: { type: Number, required: true, min: 0, max: 6 }, // 0=الأحد ... 6=السبت
  hour: { type: Number, required: true, min: 0, max: 23 },
  minute: { type: Number, required: true, min: 0, max: 59 },
  maxTickets: { type: Number, required: true },
  channelId: { type: String, required: true },
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model('Schedule', scheduleSchema);
