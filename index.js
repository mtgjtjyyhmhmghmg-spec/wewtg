// حماية عامة: أي خطأ غير ملتقط ما يطيح البوت بالكامل (بدل ما يعيد Railway تشغيله
// فجأة ويضيع أي مؤقّتات شغّالة بالذاكرة زي مؤقّت الاستدعاء أو حذف الروم)
process.on('unhandledRejection', (err) => {
  console.error('⚠️ خطأ غير ملتقط (unhandledRejection):', err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ خطأ غير ملتقط (uncaughtException):', err);
});

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');

// الاتصال بقاعدة البيانات (MongoDB) — لازم يصير قبل تحميل أي أوامر/أحداث تستخدمها
require('./database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ===== تحميل الأوامر =====
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// ===== تحميل الأحداث =====
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

client.login(process.env.DISCORD_TOKEN);
