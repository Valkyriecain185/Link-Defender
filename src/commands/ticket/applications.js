const { ApplicationCommandOptionType, ChannelType, ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { EMBED_COLORS } = require('../../../config');

module.exports = {
  name: "application",
  description: "various application commands",
  category: "APPLICATION",
  userPermissions: ["ManageGuild"],
  command: {
    enabled: true,
    minArgsCount: 1,
    subcommands: [
      {
        trigger: "setup <#channel>",
        description: "start an interactive application setup",
      },
      {
        trigger: "log <#channel>",
        description: "setup log channel for applications",
      },
    ],
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "setup",
        description: "setup a new application message",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "the channel where application creation message must be sent",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
        ],
      },
      {
        name: "log",
        description: "setup log channel for applications",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "channel",
            description: "channel where application logs must be sent",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText],
            required: true,
          },
        ],
      },
    ],
  },

  async messageRun(message, args, data) {
    const input = args[0].toLowerCase();
    let response;

    // Setup
    if (input === "setup") {
      if (!message.guild.members.me.permissions.has("ManageChannels")) {
        return message.safeReply("I am missing `Manage Channels` to create application channels");
      }
      const targetChannel = message.guild.findMatchingChannels(args[1])[0];
      if (!targetChannel) {
        return message.safeReply("I could not find channel with that name");
      }
      return applicationModalSetup(message, targetChannel, data.settings);
    }

    // log application
    else if (input === "log") {
      if (args.length < 2) return message.safeReply("Please provide a channel where application logs must be sent");
      const target = message.guild.findMatchingChannels(args[1]);
      if (target.length === 0) return message.safeReply("Could not find any matching channel");
      response = await setupLogChannel(target[0], data.settings);
    }
  },

  async interactionRun(interaction, data) {
    const subcommand = interaction.options.getSubcommand();
    let response;

    // Setup
    if (subcommand === "setup") {
      if (!interaction.guild.members.me.permissions.has("ManageChannels")) {
        return interaction.reply({ content: "I am missing `Manage Channels` to create application channels", ephemeral: true });
      }
      const targetChannel = interaction.options.getChannel("channel");
      if (!targetChannel) {
        return interaction.reply({ content: "I could not find channel with that name", ephemeral: true });
      }
      return applicationModalSetup(interaction, targetChannel, data.settings);
    }

    // log application
    else if (subcommand === "log") {
      const targetChannel = interaction.options.getChannel("channel");
      if (!targetChannel) {
        return interaction.reply({ content: "Could not find any matching channel", ephemeral: true });
      }
      response = await setupLogChannel(targetChannel, data.settings);
      return interaction.reply({ content: response, ephemeral: true });
    }
  },
};

async function applicationModalSetup({ guild, channel, member }, targetChannel, settings) {
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("application_btnSetup").setLabel("Setup Message").setStyle(ButtonStyle.Primary)
  );

  const sentMsg = await channel.safeSend({
    content: "Please click the button below to setup application message",
    components: [buttonRow],
  });

  if (!sentMsg) return;

  const btnInteraction = await channel
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === "application_btnSetup" && i.member.id === member.id && i.message.id === sentMsg.id,
      time: 20000,
    })
    .catch((ex) => {});

  if (!btnInteraction) return sentMsg.edit({ content: "No response received, cancelling setup", components: [] });

  // display modal
  await btnInteraction.showModal(
    new ModalBuilder({
      customId: "application-modalSetup",
      title: "Application Setup",
      components: [
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Embed Title")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Embed Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("footer")
            .setLabel("Embed Footer")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("image_url")
            .setLabel("Embed Image URL")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
      ],
    })
  );

  // receive modal input
  const modal = await btnInteraction
    .awaitModalSubmit({
      time: 1 * 60 * 1000,
      filter: (m) => m.customId === "application-modalSetup" && m.member.id === member.id && m.message.id === sentMsg.id,
    })
    .catch((ex) => {});

  if (!modal) return sentMsg.edit({ content: "No response received, cancelling setup", components: [] });

  await modal.reply("Setting up application message ...");
  const title = modal.fields.getTextInputValue("title");
  const description = modal.fields.getTextInputValue("description");
  const footer = modal.fields.getTextInputValue("footer");
  const imageUrl = modal.fields.getTextInputValue("image_url");

  // send application message
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: title || "Job Application" })
    .setDescription(description || "Please use the button below to apply for a job")
    .setFooter({ text: footer || "You can only have 1 open application at a time!" });

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  const appBtnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Apply for a job").setCustomId("APPLICATION_CREATE").setStyle(ButtonStyle.Success)
  );

  await targetChannel.send({ embeds: [embed], components: [appBtnRow] });
  await modal.deleteReply();
  await sentMsg.edit({ content: "Done! Application Message Created", components: [] });
}

async function setupLogChannel(channel, settings) {
  settings.applicationLogChannel = channel.id;
  await settings.save();
  return channel.safeSend("Application log channel has been set!");
}