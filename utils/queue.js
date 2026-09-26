const mongoose = require('mongoose');
const Period = require('../models/Period');
const Ticket = require('../models/Ticket');

// ============ الفترات (Activation Periods) ============

/** الفترة المفتوحة فعليًا لاستقبال تذاكر جديدة (status='open' فقط) */
async function getOpenPeriod() {
  return Period.findOne({ status: 'open' }).sort({ _id: -1 });
}

/** الفترة الحالية بغض النظر هل مفتوحة أو مكتملة (لعرض الحالة/التذكرة حتى بعد الاكتمال) */
async function getCurrentPeriod() {
  return Period.findOne({ status: { $in: ['open', 'full'] } }).sort({ _id: -1 });
}

/** يفتح فترة تفعيل جديدة */
async function openPeriod({ channelId, maxTickets }) {
  const existing = await getCurrentPeriod();
  if (existing) {
    throw new Error('يوجد فترة تفعيل مفتوحة بالفعل. أغلقها أولًا قبل فتح فترة جديدة.');
  }
  return Period.create({ channelId, maxTickets, status: 'open' });
}

/** يقفل الفترة نهائيًا (تُستخدم عند الإغلاق اليدوي أو انتهاء كل التذاكر بعد الاكتمال) */
async function closePeriod(periodId) {
  await Period.updateOne({ _id: periodId }, { status: 'closed', closedAt: new Date() });
}

/** يعلّم الفترة كمكتملة العدد (بدون قفلها نهائيًا — لسا فيه تذاكر يشتغلون عليها) */
async function markPeriodFull(periodId) {
  await Period.updateOne({ _id: periodId }, { status: 'full' });
}

async function setPanelMessage(periodId, messageId) {
  await Period.updateOne({ _id: periodId }, { panelMessageId: messageId });
}

async function setCountdownMessage(periodId, messageId) {
  await Period.updateOne({ _id: periodId }, { countdownMessageId: messageId });
}

async function getPeriod(periodId) {
  return Period.findById(periodId);
}

// ============ التذاكر (Tickets) ============

async function countTicketsInPeriod(periodId) {
  return Ticket.countDocuments({ periodId });
}

/** كم تذكرة لسا "شغّالة" (منتظرة أو قيد المعالجة) بفترة معينة — تُستخدم لمعرفة متى ننهي الفترة */
async function countOpenTickets(periodId) {
  return Ticket.countDocuments({ periodId, status: { $in: ['waiting', 'claimed'] } });
}

async function getUserOpenTicket(periodId, userId) {
  return Ticket.findOne({ periodId, userId, status: { $ne: 'closed' } });
}

/**
 * يصدر تذكرة جديدة للعضو ضمن فترة معينة، مع مراعاة الحد الأقصى.
 * كل الفحوصات + الإدراج داخل transaction واحدة (MongoDB replica-set transaction —
 * متوفرة تلقائيًا على MongoDB Atlas حتى بالخطة المجانية M0). هذا يمنع فعليًا أي احتمال
 * يفتح فيه نفس العضو تذكرتين بضغطتين سريعتين، أو يتجاوز الحد الأقصى بضغط متزامن.
 * يرجّع { ticket, becameFull } — becameFull=true لو هذي آخر تذكرة أوصلت للحد الأقصى.
 */
async function issueTicket({ periodId, userId }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const period = await Period.findById(periodId).session(session);
      if (!period) throw new Error('التفعيل مقفول حاليًا، انتظر فترة تفعيل جديدة.');
      if (period.status === 'full' || period.status === 'closed') {
        throw new Error('❌ التكتات اكتمل، تم الاكتفاء بالعدد المطلوب لهذه الفترة.');
      }

      const already = await Ticket.findOne({ periodId, userId, status: { $ne: 'closed' } }).session(session);
      if (already) {
        throw new Error(`عندك تذكرة مفتوحة بالفعل برقم #${already.ticketNumber}.`);
      }

      if (period.ticketCount >= period.maxTickets) {
        throw new Error('❌ التكتات اكتمل، تم الاكتفاء بالعدد المطلوب لهذه الفترة.');
      }

      const ticketNumber = period.ticketCount + 1;
      period.ticketCount = ticketNumber;
      const becameFull = ticketNumber >= period.maxTickets;
      if (becameFull) period.status = 'full';
      await period.save({ session });

      const created = await Ticket.create([{ periodId, ticketNumber, userId, status: 'waiting' }], { session });
      result = { ticket: created[0], becameFull };
    });
    return result;
  } catch (err) {
    if (err.code === 11000) {
      throw new Error('عندك تذكرة مفتوحة بالفعل.');
    }
    throw err;
  } finally {
    session.endSession();
  }
}

async function setTicketChannel(ticketId, channelId) {
  await Ticket.updateOne({ _id: ticketId }, { channelId });
}

async function getTicket(ticketId) {
  return Ticket.findById(ticketId);
}

async function getTicketByChannel(channelId) {
  return Ticket.findOne({ channelId });
}

/** كم شخص قدام هذا العضو (تذاكر أرقامها أقل وما زالت منتظرة) */
async function getPositionInfo(ticket) {
  return Ticket.countDocuments({ periodId: ticket.periodId, status: 'waiting', ticketNumber: { $lt: ticket.ticketNumber } });
}

/**
 * استلام التذكرة — عملية atomic كاملة (فحص الترتيب + التحديث) داخل transaction واحدة.
 * مستحيل يستلم إداريان نفس التذكرة أو يتجاوزون الترتيب حتى لو ضغطوا بنفس اللحظة بالضبط.
 * يرمي: NOT_FOUND | ALREADY_CLAIMED | BLOCKED:<رقم التذكرة المطلوب استلامها أولًا>
 */
async function claimTicket(ticketId, staffId) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const ticket = await Ticket.findById(ticketId).session(session);
      if (!ticket) throw new Error('NOT_FOUND');
      if (ticket.status !== 'waiting') throw new Error('ALREADY_CLAIMED');

      const blocker = await Ticket.findOne({
        periodId: ticket.periodId,
        status: 'waiting',
        ticketNumber: { $lt: ticket.ticketNumber },
      })
        .sort({ ticketNumber: 1 })
        .session(session);
      if (blocker) throw new Error(`BLOCKED:${blocker.ticketNumber}`);

      ticket.status = 'claimed';
      ticket.claimedBy = staffId;
      ticket.claimedAt = new Date();
      await ticket.save({ session });
      result = ticket;
    });
    return result;
  } finally {
    session.endSession();
  }
}

/** إغلاق التذكرة مع سبب إلزامي — findOneAndUpdate الشرطي يمنع إغلاقها مرتين بالتزامن */
async function closeTicket(ticketId, staffId, reason) {
  const ticket = await Ticket.findOneAndUpdate(
    { _id: ticketId, status: { $ne: 'closed' } },
    { status: 'closed', closedBy: staffId, closeReason: reason, closedAt: new Date() },
    { new: true }
  );
  if (!ticket) {
    const existing = await Ticket.findById(ticketId);
    if (!existing) throw new Error('NOT_FOUND');
    throw new Error('ALREADY_CLOSED');
  }
  return ticket;
}

/** ملخص حالة الطابور لفترة معينة */
async function getQueueSummary(periodId) {
  const rows = await Ticket.aggregate([{ $match: { periodId: new mongoose.Types.ObjectId(periodId) } }, { $group: { _id: '$status', c: { $sum: 1 } } }]);
  const summary = { waiting: 0, claimed: 0, closed: 0 };
  for (const r of rows) summary[r._id] = r.c;

  const period = await getPeriod(periodId);
  summary.total = period.ticketCount;
  summary.max = period.maxTickets;
  return summary;
}

// ============ الاستدعاء (Summon) ============

async function setSummoned(ticketId, staffId) {
  const now = new Date();
  await Ticket.updateOne({ _id: ticketId }, { summonedAt: now, summonedBy: staffId });
  return now.toISOString();
}

async function clearSummon(ticketId) {
  await Ticket.updateOne({ _id: ticketId }, { summonedAt: null, summonedBy: null });
}

async function isSummonStillPending(ticketId, snapshot) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return false;
  if (ticket.status === 'closed') return false;
  if (!ticket.summonedAt) return false;
  return ticket.summonedAt.toISOString() === snapshot;
}

// ============ ترانزكريبت الرسائل ============

/** يضيف رسالة لسجل ترانزكريبت التذكرة (تُستخدم بملف اللوق عند الإغلاق) */
async function appendTicketMessage(ticketId, { authorId, authorTag, content }) {
  await Ticket.updateOne({ _id: ticketId }, { $push: { messages: { authorId, authorTag, content, createdAt: new Date() } } });
}

module.exports = {
  getOpenPeriod,
  getCurrentPeriod,
  openPeriod,
  closePeriod,
  markPeriodFull,
  setPanelMessage,
  setCountdownMessage,
  getPeriod,
  countTicketsInPeriod,
  countOpenTickets,
  getUserOpenTicket,
  issueTicket,
  setTicketChannel,
  getTicket,
  getTicketByChannel,
  getPositionInfo,
  claimTicket,
  closeTicket,
  getQueueSummary,
  setSummoned,
  clearSummon,
  isSummonStillPending,
  appendTicketMessage,
};
