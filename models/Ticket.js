const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    authorId: String,
    authorTag: String,
    content: String,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema({
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Period', required: true },
  ticketNumber: { type: Number, required: true },
  userId: { type: String, required: true },
  channelId: { type: String, default: null },
  status: { type: String, enum: ['waiting', 'claimed', 'closed'], default: 'waiting' },
  claimedBy: { type: String, default: null },
  closedBy: { type: String, default: null },
  closeReason: { type: String, default: null },
  summonedAt: { type: Date, default: null },
  summonedBy: { type: String, default: null },
  messages: { type: [messageSchema], default: [] }, // ترانزكريبت رسائل روم التكت
  openedAt: { type: Date, default: Date.now },
  claimedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
});

// يمنع أي عضو من امتلاك أكثر من تذكرة غير مغلقة بنفس الفترة
ticketSchema.index(
  { periodId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: 'closed' } } }
);
ticketSchema.index({ periodId: 1, status: 1, ticketNumber: 1 });
ticketSchema.index({ channelId: 1 });

module.exports = mongoose.model('Ticket', ticketSchema);
