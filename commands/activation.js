const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const queue = require('../utils/queue');
const { buildPanelEmbed, buildQueueStatusEmbed } = require('../utils/embeds');
const { buildPanelButtons } = require('../utils/buttons');
const { deletePanelMessage } = require('../utils/panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('نشاط')
    .setDescription('فتح أو إغلاق التفعيل يدويًا')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('فتح')
        .setDescription('فتح فترة تفعيل جديدة يدويًا')
        .addIntegerOption((opt) =>
          opt.setName('الحد_الأقصى').setDescription('أقصى عدد تذاكر لهذه الفترة').setRequired(true).setMinValue(1)
        )
        .addChannelOption((opt) =>
          opt.setName('الروم').setDescription('روم نشر البانل (افتراضيًا الروم الحالي)').addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) => sub.setName('اغلاق').setDescription('إغلاق استقبال تذاكر جديدة للفترة الحالية'))
    .addSubcommand((sub) => sub.setName('حالة').setDescription('عرض حالة الفترة الحالية')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'فتح') {
      const maxTickets = interaction.options.getInteger('الحد_الأقصى');
      const channel = interaction.options.getChannel('الروم') || interaction.channel;

      let period;
      try {
        period = queue.openPeriod({ channelId: channel.id, maxTickets });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }

      await interaction.reply({ content: `⏰ سيتم فتح التفعيل خلال 5 ثواني في ${channel}...`, ephemeral: true });
      const pingRoleId = process.env.ACTIVATION_PING_ROLE_ID;
      const pingMention = pingRoleId ? `<@&${pingRoleId}>\n\n` : '';
      await channel.send(`${pingMention}⏰ **5 ثواني وتبدأ فترة التفعيل!**`);

      setTimeout(async () => {
        const embed = buildPanelEmbed(period);
        const row = buildPanelButtons();
        const msg = await channel.send({ embeds: [embed], components: [row] });
        queue.setPanelMessage(period.id, msg.id);
      }, 5000);
    }

    if (sub === 'اغلاق') {
      const period = queue.getOpenPeriod();
      if (!period) {
        return interaction.reply({ content: 'ما فيه فترة تفعيل مفتوحة حاليًا.', ephemeral: true });
      }
      queue.closePeriod(period.id);
      await interaction.reply({ content: `🔒 تم إغلاق استقبال تذاكر جديدة للفترة #${period.id}.`, ephemeral: true });
      await deletePanelMessage(interaction.client, period);
    }

    if (sub === 'حالة') {
      const period = queue.getOpenPeriod();
      if (!period) {
        return interaction.reply({ content: 'ما فيه فترة تفعيل مفتوحة حاليًا.', ephemeral: true });
      }
      await interaction.reply({ embeds: [buildQueueStatusEmbed(period)], ephemeral: true });
    }
  },
};
