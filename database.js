const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH يسمح بتخزين قاعدة البيانات بمسار دائم (مثلاً Railway Volume) بدل
// مجلد التطبيق نفسه، اللي ينمسح مع كل عملية Redeploy على استضافات زي Railway.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bot.db');

if (!process.env.DB_PATH) {
  console.warn(
    '⚠️ تحذير: DB_PATH غير معرّف — قاعدة البيانات محفوظة بمجلد التطبيق (' +
      DB_PATH +
      '). لو تشغّل على Railway بدون Volume دائم، كل الجداول والتذاكر ' +
      'تنمسح مع كل عملية Redeploy/إعادة تشغيل! راجع تعليمات التخزين الدائم بالـ README.'
  );
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

console.log(`📦 قاعدة البيانات: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ============ إنشاء الجداول ============

db.exec(`
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week INTEGER NOT NULL,      -- 0 = الأحد ... 6 = السبت (يطابق ترقيم node-cron)
  hour INTEGER NOT NULL,             -- الساعة بتوقيت السعودية (0-23)
  minute INTEGER NOT NULL,           -- الدقيقة (0-59)
  max_tickets INTEGER NOT NULL,      -- الحد الأقصى للتكتات لهذا الموعد
  channel_id TEXT NOT NULL,          -- روم فتح البانل
  active INTEGER NOT NULL DEFAULT 1, -- 1 = مفعّل، 0 = موقوف مؤقتًا
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,          -- الروم اللي فيه البانل
  panel_message_id TEXT,             -- رسالة البانل (يتم تحديثها بالعداد)
  max_tickets INTEGER NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,  -- عدد التذاكر اللي صدرت لين الحين
  status TEXT NOT NULL DEFAULT 'open',      -- open | closed
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL,
  ticket_number INTEGER NOT NULL,    -- رقم التذكرة داخل نفس الفترة (1, 2, 3 ...)
  user_id TEXT NOT NULL,
  channel_id TEXT,                   -- روم التكت الخاص بهذا العضو
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | claimed | closed
  claimed_by TEXT,
  closed_by TEXT,
  close_reason TEXT,
  summoned_at TEXT,                  -- وقت آخر استدعاء (NULL = ما فيه استدعاء نشط)
  summoned_by TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  closed_at TEXT,
  FOREIGN KEY (period_id) REFERENCES periods(id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_period ON tickets(period_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(period_id, status);

-- يمنع أي عضو من امتلاك أكثر من تذكرة غير مغلقة بنفس الفترة (حماية على مستوى قاعدة البيانات
-- ضد الضغط المزدوج أو أي محاولة فتح تذكرتين بنفس الوقت)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_ticket_per_user
  ON tickets(period_id, user_id)
  WHERE status != 'closed';
`);

// مايجريشن آمن لقواعد بيانات موجودة من قبل هذا التحديث (تُتجاهل الأخطاء لو الأعمدة موجودة أصلًا)
for (const stmt of [
  `ALTER TABLE tickets ADD COLUMN summoned_at TEXT`,
  `ALTER TABLE tickets ADD COLUMN summoned_by TEXT`,
]) {
  try {
    db.exec(stmt);
  } catch (_) {
    /* العمود موجود أصلًا */
  }
}

module.exports = db;
