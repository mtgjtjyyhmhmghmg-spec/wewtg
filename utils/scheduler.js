const cron = require('node-cron');
const db = require('../database');
const queue = require('./queue');
const { buildPanelEmbed } = require('./embeds');
const { buildPanelButtons } = require('./buttons');

const TIMEZONE = 'Asia/Riyadh';
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const REMINDER_CHANNEL_ID = process.env.REMINDER_CHANNEL_ID;
const ACTIVATION_PING_ROLE_ID = process.env.ACTIVATION_PING_ROLE_ID;

const REMINDER_60_TEXT =
  'تذكيييير التفعيل القادم بعد ساعة \n\nخلك جاهز وفضي وقتك حضوركم مهم لنجاح التفعيل اليوم \n\nشكرا لجهودكم جميعآ';
const REMINDER_15_TEXT = 'تذكير أخير متبقي 15 دقيقة ويتم افتتاح التفعيل';

// خريطة تحتفظ بكل مهام cron النشطة لكل جدول: scheduleId -> { main, r60, r15 }
const activeJobs = new Map();

const DAY_NAME = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** يطرح دقائق من {day_of_week, hour, minute} مع مراعاة رجوع اليوم/الأسبوع */
function subtractMinutes({ day_of_week, hour, minute }, minutesToSubtract) {
  let total = hour * 60 + minute - minutesToSubtract;
  let dayOffset = 0;
  while (total < 0) {
    total += 24 * 60;
    dayOffset -= 1;
  }
  const newHour = Math.floor(total / 60) % 24;
  const newMinute = total % 60;
  let newDay = (day_of_week + dayOffset) % 7;
  if (newDay < 0) newDay += 7;
  return { day_of_week: newDay, hour: newHour, minute: newMinute };
}

async function openPeriodFromSchedule(client, schedule) {
  try {
    console.log(`[جدولة] ⏰ تنفيذ الجدول #${schedule.id} الآن (${DAY_NAME[schedule.day_of_week]} ${pad(schedule.hour)}:${pad(schedule.minute)})`);

    const channel = await client.channels.fetch(schedule.channel_id);
    if (!channel) {
      console.error(`[جدولة] ❌ ما قدرت ألقى الروم ${schedule.channel_id} للجدول #${schedule.id}`);
      return;
    }

    // لو فيه فترة مفتوحة أصلًا، لا نفتح وحدة جديدة فوقها
    const existing = queue.getOpenPeriod();
    if (existing) {
      console.log(`[جدولة] تخطي فتح جدول #${schedule.id} لأن فيه فترة مفتوحة بالفعل (#${existing.id}).`);
      return;
    }

    const period = queue.openPeriod({ channelId: schedule.channel_id, maxTickets: schedule.max_tickets });

    const pingMention = ACTIVATION_PING_ROLE_ID ? `<@&${ACTIVATION_PING_ROLE_ID}>\n\n` : '';
    await channel.send(`${pingMention}⏰ **5 ثواني وتبدأ فترة التفعيل!**`);
    await new Promise((res) => setTimeout(res, 5000));

    const embed = buildPanelEmbed(period);
    const row = buildPanelButtons();
    const msg = await channel.send({ embeds: [embed], components: [row] });

    queue.setPanelMessage(period.id, msg.id);
    console.log(`[جدولة] ✅ تم فتح فترة #${period.id} من الجدول #${schedule.id}`);
  } catch (err) {
    console.error(`[جدولة] ❌ خطأ أثناء فتح فترة من الجدول #${schedule.id}:`, err);
  }
}

async function sendReminder(client, schedule, text) {
  try {
    const channelId = REMINDER_CHANNEL_ID || schedule.channel_id;
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error(`[تذكير] ❌ ما قدرت ألقى روم التذكيرات ${channelId}`);
      return;
    }
    const mention = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : '';
    await channel.send(`${mention}\n\n${text}`);
    console.log(`[تذكير] ✅ تم إرسال تذكير للجدول #${schedule.id}`);
  } catch (err) {
    console.error(`[تذكير] ❌ خطأ أثناء إرسال التذكير للجدول #${schedule.id}:`, err);
  }
}

/** node-cron: minute hour dayOfMonth month dayOfWeek */
function toCronExpression({ day_of_week, hour, minute }) {
  return `${minute} ${hour} * * ${day_of_week}`;
}

function registerJob(client, schedule) {
  unregisterJob(schedule.id);
  if (!schedule.active) return;

  const mainExpr = toCronExpression(schedule);
  const r60Time = subtractMinutes(schedule, 60);
  const r15Time = subtractMinutes(schedule, 15);
  const r60Expr = toCronExpression(r60Time);
  const r15Expr = toCronExpression(r15Time);

  console.log(
    `[جدولة] 🗓️ تسجيل الجدول #${schedule.id}: ${DAY_NAME[schedule.day_of_week]} ${pad(schedule.hour)}:${pad(schedule.minute)} ` +
      `(توقيت السعودية) — cron: "${mainExpr}" | تذكير الساعة: "${r60Expr}" | تذكير 15د: "${r15Expr}"`
  );

  const mainTask = cron.schedule(mainExpr, () => openPeriodFromSchedule(client, schedule), { timezone: TIMEZONE });
  const r60Task = cron.schedule(r60Expr, () => sendReminder(client, schedule, REMINDER_60_TEXT), { timezone: TIMEZONE });
  const r15Task = cron.schedule(r15Expr, () => sendReminder(client, schedule, REMINDER_15_TEXT), { timezone: TIMEZONE });

  activeJobs.set(schedule.id, { main: mainTask, r60: r60Task, r15: r15Task });
}

function unregisterJob(scheduleId) {
  const existing = activeJobs.get(scheduleId);
  if (existing) {
    existing.main.stop();
    existing.r60.stop();
    existing.r15.stop();
    activeJobs.delete(scheduleId);
  }
}

/** يحمّل كل الجداول من قاعدة البيانات ويسجلها كمهام cron (يُستدعى عند تشغيل البوت) */
function loadAllSchedules(client) {
  const now = new Date();
  const riyadhNow = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(now);
  console.log(`[جدولة] 🕐 الوقت الحالي بتوقيت السعودية: ${riyadhNow}`);

  const schedules = db.prepare(`SELECT * FROM schedules WHERE active = 1`).all();
  for (const s of schedules) registerJob(client, s);
  console.log(`[جدولة] تم تحميل ${schedules.length} جدول (توقيت السعودية).`);

  if (schedules.length === 0) {
    console.warn(
      '[جدولة] ⚠️ ما فيه أي جدول محفوظ حاليًا بقاعدة البيانات. لو أضفت جداول قبل كذا ' +
        'واختفت، هذا يدل غالبًا إن قاعدة البيانات انمسحت (شوف تحذير DB_PATH بالأعلى وفعّل ' +
        'Volume دائم على Railway).'
    );
  }
}

module.exports = { registerJob, unregisterJob, loadAllSchedules, TIMEZONE };
