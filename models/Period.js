const mongoose = require('mongoose');

const periodSchema = new mongoose.Schema({
  channelId: { type: String, required: true },
  panelMessageId: { type: String, default: null },
  countdownMessageId: { type: String, default: null }, // رسالة "5 ثواني" — تُحذف مع إغلاق الفترة
  maxTickets: { type: Number, required: true },
  ticketCount: { type: Number, default: 0 },
  status: { type: String, enum: ['open', 'full', 'closed'], default: 'open' },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
});

module.exports = mongoose.model('Period', periodSchema);
