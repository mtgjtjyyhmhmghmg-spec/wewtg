const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const Schedule = require('../models/Schedule');
const { registerJob, unregisterJob } = require('../utils/scheduler');

// أيام الأسبوع بترقيم node-cron: 0 = الأحد ... 6 = السبت
const DAYS = [
  { name: 'الأحد', value: 0 },
  { name: 'الاثنين', value: 1 },
  { name: 'الثلاثاء', value: 2 },
  { name: 'الأربعاء', value: 3 },
  { name: 'الخميس', value: 4 },
  { name: 'الجمعة', value: 5 },
  { name: 'السبت', value: 6 },
];
const DAY_NAME = Object.fromEntries(DAYS.map((d) => [d.value, d.name]));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('جدولة')
    .setDescription('إدارة الجدولة الأسبوعية لفتح التفعيل (بتوقيت السعودية)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('اضافة')
        .setDescription('إضافة موعد أسبوعي جديد لفتح التفعيل')
        .addStringOption((opt) =>
          opt
            .setName('اليوم')
            .setDescription('يوم الأسبوع')
            .setRequired(true)
            .addChoices(...DAYS.map((d) => ({ name: d.name, value: String(d.value) })))
        )
        .addIntegerOption((opt) =>
          opt.setName('الساعة').setDescription('الساعة (0-23) بتوقيت السعودية').setRequired(true).setMinValue(0).setMaxValue(23)
        )
        .addIntegerOption((opt) =>
          opt.setName('الدقيقة').setDescription('الدقيقة (0-59)').setRequired(true).setMinValue(0).setMaxValue(59)
        )
        .addIntegerOption((opt) =>
          opt.setName('الحد_الأقصى').setDescription('أقصى عدد تذاكر لهذا الموعد').setRequired(true).setMinValue(1)
        )
        .addChannelOption((opt) =>
          opt
            .setName('الروم')
            .setDescription('روم نشر بانل التفعيل')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('عرض').setDescription('عرض كل الجداول الحالية'))
    .addSubcommand((sub) =>
      sub
        .setName('تعديل')
        .setDescription('تعديل جدول موجود')
        .addStringOption((opt) => opt.setName('id').setDescription('معرف الجدول (من أمر عرض)').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('اليوم')
            .setDescription('يوم الأسبوع الجديد')
            .addChoices(...DAYS.map((d) => ({ name: d.name, value: String(d.value) })))
        )
        .addIntegerOption((opt) => opt.setName('الساعة').setDescription('الساعة الجديدة (0-23)').setMinValue(0).setMaxValue(23))
        .addIntegerOption((opt) => opt.setName('الدقيقة').setDescription('الدقيقة الجديدة (0-59)').setMinValue(0).setMaxValue(59))
        .addIntegerOption((opt) => opt.setName('الحد_الأقصى').setDescription('الحد الأقصى الجديد').setMinValue(1))
        .addChannelOption((opt) =>
          opt.setName('الروم').setDescription('الروم الجديد').addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((opt) => opt.setName('مفعل').setDescription('تفعيل أو إيقاف هذا الجدول مؤقتًا'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('حذف')
        .setDescription('حذف جدول')
        .addStringOption((opt) => opt.setName('id').setDescription('معرف الجدول (من أمر عرض)').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'اضافة') {
      const day = Number(interaction.options.getString('اليوم'));
      const hour = interaction.options.getInteger('الساعة');
      const minute = interaction.options.getInteger('الدقيقة');
      const maxTickets = interaction.options.getInteger('الحد_الأقصى');
      const channel = interaction.options.getChannel('الروم');

      const schedule = await Schedule.create({ dayOfWeek: day, hour, minute, maxTickets, channelId: channel.id });
      registerJob(interaction.client, schedule);

      await interaction.reply({
        content: `✅ تمت إضافة الجدول \`${schedule._id}\`: كل **${DAY_NAME[day]}** الساعة **${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}** بتوقيت السعودية، بروم ${channel}، بحد أقصى **${maxTickets}** تذكرة.`,
        ephemeral: true,
      });
    }

    if (sub === 'عرض') {
      const schedules = await Schedule.find().sort({ dayOfWeek: 1, hour: 1, minute: 1 });
      if (schedules.length === 0) {
        return interaction.reply({ content: 'لا يوجد أي جداول حاليًا.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🗓️ الجداول الأسبوعية (توقيت السعودية)')
        .setColor(0x5865f2)
        .setDescription(
          schedules
            .map(
              (s) =>
                `\`${s._id}\` — ${DAY_NAME[s.dayOfWeek]} الساعة ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} | حد أقصى: ${s.maxTickets} | الروم: <#${s.channelId}> | ${s.active ? '🟢 مفعّل' : '🔴 موقوف'}`
            )
            .join('\n')
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'تعديل') {
      const id = interaction.options.getString('id');
      const existing = await Schedule.findById(id).catch(() => null);
      if (!existing) {
        return interaction.reply({ content: '❌ ما فيه جدول بهذا المعرف.', ephemeral: true });
      }

      const day = interaction.options.getString('اليوم');
      const hour = interaction.options.getInteger('الساعة');
      const minute = interaction.options.getInteger('الدقيقة');
      const maxTickets = interaction.options.getInteger('الحد_الأقصى');
      const channel = interaction.options.getChannel('الروم');
      const active = interaction.options.getBoolean('مفعل');

      if (day !== null) existing.dayOfWeek = Number(day);
      if (hour !== null) existing.hour = hour;
      if (minute !== null) existing.minute = minute;
      if (maxTickets !== null) existing.maxTickets = maxTickets;
      if (channel) existing.channelId = channel.id;
      if (active !== null) existing.active = active;
      await existing.save();

      if (existing.active) registerJob(interaction.client, existing);
      else unregisterJob(existing._id);

      await interaction.reply({ content: `✅ تم تحديث الجدول \`${id}\`.`, ephemeral: true });
    }

    if (sub === 'حذف') {
      const id = interaction.options.getString('id');
      const existing = await Schedule.findByIdAndDelete(id).catch(() => null);
      if (!existing) {
        return interaction.reply({ content: '❌ ما فيه جدول بهذا المعرف.', ephemeral: true });
      }
      unregisterJob(id);
      await interaction.reply({ content: `🗑️ تم حذف الجدول \`${id}\`.`, ephemeral: true });
    }
  },
};
