// يسلسل كل عمليات إنشاء رومات التكتات بدل ما تنطلق كلها دفعة وحدة وقت الضغط العالي.
// ديسكورد يحدد عدد عمليات إنشاء الرومات المسموحة بكل سيرفر خلال فترة قصيرة، فلو
// ضغطنا 30 طلب إنشاء روم بنفس اللحظة، جزء منهم يفشل أو يتأخر كثير. هذا الطابور
// يمررهم واحد وراء الثاني بفاصل زمني آمن، فديسكورد ما يشوف إلا طلب وحد كل مرة.

const MIN_GAP_MS = Number(process.env.CHANNEL_CREATE_GAP_MS) || 2500;

let chain = Promise.resolve();

/** يضيف مهمة للطابور، ترجع نتيجتها، وتنتظر دورها بالتسلسل مع فاصل آمن بعدها */
function enqueue(task) {
  const run = chain.then(async () => {
    try {
      return await task();
    } finally {
      await new Promise((res) => setTimeout(res, MIN_GAP_MS));
    }
  });
  // نمنع فشل مهمة واحدة من كسر سلسلة الطابور كاملة للمهام اللي بعدها
  chain = run.catch(() => {});
  return run;
}

/** يعيد محاولة أي عملية async عدة مرات بفاصل متزايد (للتعامل مع 429 المؤقتة) */
async function withRetry(fn, { attempts = 3, baseDelayMs = 1500, label = 'عملية' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ محاولة ${label} فشلت (${i + 1}/${attempts}):`, err.message);
      // بعض الأخطاء (زي امتلاء الكاتيجوري) إعادة المحاولة ما تفيد فيها أبدًا —
      // نوقف فورًا بدل ما نضيع وقت على محاولات محكوم عليها بالفشل سلفًا
      if (err.stopRetrying) break;
      if (i < attempts - 1) {
        await new Promise((res) => setTimeout(res, baseDelayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

module.exports = { enqueue, withRetry };
