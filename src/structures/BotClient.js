const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  WebhookClient,
  ApplicationCommandType,
} = require("discord.js");
const path = require("path");
const { table } = require("table");
const Logger = require("../helpers/Logger");
const { recursiveReadDirSync } = require("../helpers/Utils");
const { validateCommand, validateContext } = require("../helpers/Validator");
const { schemas } = require("@src/database/mongoose");
const CommandCategory = require("./CommandCategory");
const lavaclient = require("../handlers/lavaclient");
const giveawaysHandler = require("../handlers/giveaway");
const { DiscordTogether } = require("discord-together");

module.exports = class BotClient extends Client {
  constructor() {
      super({
          intents: [
              GatewayIntentBits.Guilds,
              GatewayIntentBits.GuildMessages,
              GatewayIntentBits.MessageContent,
              GatewayIntentBits.GuildInvites,
              GatewayIntentBits.GuildMembers,
              GatewayIntentBits.GuildPresences,
              GatewayIntentBits.GuildMessageReactions,
              GatewayIntentBits.GuildVoiceStates,
          ],
          partials: [Partials.User, Partials.Message, Partials.Reaction],
          allowedMentions: {
              repliedUser: false,
          },
          restRequestTimeout: 20000,
      });

      this.wait = require("util").promisify(setTimeout); // await client.wait(1000) - Wait 1 second
      this.config = require("@root/config"); // Load the config file

      this.commands = []; // Store actual command
      this.commandIndex = new Collection(); // Store (alias, arrayIndex) pair

      this.slashCommands = new Collection(); // Store slash commands
      this.contextMenus = new Collection(); // Store context menus
      this.counterUpdateQueue = []; // Store guildId's that need counter update

      // Initialize webhook for sending guild join/leave details
      this.joinLeaveWebhook = process.env.JOIN_LEAVE_LOGS
          ? new WebhookClient({ url: process.env.JOIN_LEAVE_LOGS })
          : undefined;

      // Music Player
      if (this.config.MUSIC.ENABLED) this.musicManager = lavaclient(this);

      // Giveaways
      if (this.config.GIVEAWAYS.ENABLED) this.giveawaysManager = giveawaysHandler(this);

      // Logger
      this.logger = Logger;

      // Database
      this.database = schemas;

      // Discord Together
      this.discordTogether = new DiscordTogether(this);
  }

  /**
   * Load all events from the specified directory
   * @param {string} directory directory containing the event files
   */
  loadEvents(directory) {
      this.logger.log(`Loading events...`);
      let success = 0;
      let failed = 0;
      const clientEvents = [];

      recursiveReadDirSync(directory).forEach((filePath) => {
          const file = path.basename(filePath);
          try {
              const eventName = path.basename(file, ".js");
              const event = require(filePath);

              this.on(eventName, event.bind(null, this));
              clientEvents.push([file, "✓"]);

              delete require.cache[require.resolve(filePath)];
              success += 1;
          } catch (ex) {
              failed += 1;
              this.logger.error(`loadEvent - ${file}`, ex);
          }
      });

      console.log(
          table(clientEvents, {
              header: {
                  alignment: "center",
                  content: "Client Events",
              },
              singleLine: true,
              columns: [{ width: 25 }, { width: 5, alignment: "center" }],
          })
      );

      this.logger.log(`Loaded ${success + failed} events. Success (${success}) Failed (${failed})`);
  }

  /**
   * Find command matching the invoke
   * @param {string} invoke
   * @returns {import('@structures/Command')|undefined}
   */
  getCommand(invoke) {
      const index = this.commandIndex.get(invoke.toLowerCase());
      return index !== undefined ? this.commands[index] : undefined;
  }

  /**
   * Register command file in the client
   * @param {import("@structures/Command")} cmd
   */
  loadCommand(cmd) {
      // Check if category is disabled
      if (cmd.category && CommandCategory[cmd.category]?.enabled === false) {
          this.logger.debug(`Skipping Command ${cmd.name}. Category ${cmd.category} is disabled`);
          return;
      }
      // Prefix Command
      if (cmd.command?.enabled) {
          const index = this.commands.length;
          if (this.commandIndex.has(cmd.name)) {
              throw new Error(`Command ${cmd.name} already registered`);
          }
          if (Array.isArray(cmd.command.aliases)) {
              cmd.command.aliases.forEach((alias) => {
                  if (this.commandIndex.has(alias)) throw new Error(`Alias ${alias} already registered`);
                  this.commandIndex.set(alias.toLowerCase(), index);
              });
          }
          this.commandIndex.set(cmd.name.toLowerCase(), index);
          this.commands.push(cmd);
      } else {
          this.logger.debug(`Skipping command ${cmd.name}. Disabled!`);
      }

      // Slash Command
      if (cmd.slashCommand?.enabled) {
          if (this.slashCommands.has(cmd.name)) throw new Error(`Slash Command ${cmd.name} already registered`);
          this.slashCommands.set(cmd.name, cmd);
      } else {
          this.logger.debug(`Skipping slash command ${cmd.name}. Disabled!`);
      }
  }

  /**
   * Load all commands from the specified directory
   * @param {string} directory
   */
  loadCommands(directory) {
      this.logger.log(`Loading commands...`);
      const files = recursiveReadDirSync(directory);
      for (const file of files) {
          try {
              const cmd = require(file);
              if (typeof cmd !== "object") continue;
              validateCommand(cmd);
              this.loadCommand(cmd);
          } catch (ex) {
              this.logger.error(`Failed to load ${file} Reason: ${ex.message}`);
          }
      }

      this.logger.success(`Loaded ${this.commands.length} commands`);
      this.logger.success(`Loaded ${this.slashCommands.size} slash commands`);

      if (this.slashCommands.size > 100) throw new Error("A maximum of 100 slash commands can be enabled");
  }

  /**
   * Load all contexts from the specified directory
   * @param {string} directory
   */
  loadContexts(directory) {
      this.logger.log(`Loading contexts...`);
      const files = recursiveReadDirSync(directory);
      for (const file of files) {
          try {
              const ctx = require(file);
              if (typeof ctx !== "object") continue;
              validateContext(ctx);
              if (!ctx.enabled) return this.logger.debug(`Skipping context ${ctx.name}. Disabled!`);
              if (this.contextMenus.has(ctx.name)) throw new Error(`Context already exists with that name`);
              this.contextMenus.set(ctx.name, ctx);
          } catch (ex) {
              this.logger.error(`Failed to load ${file} Reason: ${ex.message}`);
          }
      }

      const userContexts = this.contextMenus.filter((ctx) => ctx.type === ApplicationCommandType.User).size;
      const messageContexts = this.contextMenus.filter((ctx) => ctx.type === ApplicationCommandType.Message).size;

      if (userContexts > 3) throw new Error("A maximum of 3 USER contexts can be enabled");
      if (messageContexts > 3) throw new Error("A maximum of 3 MESSAGE contexts can be enabled");

      this.logger.success(`Loaded ${userContexts} USER contexts`);
      this.logger.success(`Loaded ${messageContexts} MESSAGE contexts`);
  }

  /**
   * Register slash command on startup
   * @param {string} [guildId]
   */
  async registerInteractions(guildId) {
      const toRegister = [];

      try {
          // Fetch existing commands
          const existingCommands = guildId 
              ? await this.guilds.cache.get(guildId)?.commands.fetch() 
              : await this.application.commands.fetch();

          console.log("Existing Commands:", existingCommands.map(cmd => cmd.name));

          // Prepare commands to register
          if (this.config.INTERACTIONS.SLASH) {
              this.slashCommands
                  .map((cmd) => ({
                      name: cmd.name,
                      description: cmd.description,
                      type: ApplicationCommandType.ChatInput,
                      options: cmd.slashCommand.options,
                  }))
                  .forEach((s) => toRegister.push(s));
          }

          // Prepare context menus
          if (this.config.INTERACTIONS.CONTEXT) {
              this.contextMenus
                  .map((ctx) => ({
                      name: ctx.name,
                      type: ctx.type,
                  }))
                  .forEach((c) => toRegister.push(c));
          }

          console.log("Commands to Register:", toRegister);

          // Check for the Entry Point command
          const entryPointCommandName = 'your_entry_point_command_name'; // Replace with actual name
          const entryPointCommand = existingCommands.find(cmd => cmd.name === entryPointCommandName);

          // If the Entry Point command exists and is not already included, add it
          if (entryPointCommand) {
              const entryPointCommandToRegister = {
                  name: entryPointCommand.name,
                  description: entryPointCommand.description,
                  type: ApplicationCommandType.ChatInput,
                  options: entryPointCommand.options,
              };

              // Ensure the Entry Point command is included in the toRegister array
              const alreadyRegistered = toRegister.some(cmd => cmd.name === entryPointCommandToRegister.name);
              if (!alreadyRegistered) {
                  toRegister.push(entryPointCommandToRegister);
              }
          }

          // Register globally
          if (!guildId) {
              await this.application.commands.set(toRegister);
          }
          // Register for a specific guild
          else if (guildId && typeof guildId === "string") {
              const guild = this.guilds.cache.get(guildId);
              if (!guild) {
                  this.logger.error(`Failed to register interactions in guild ${guildId}`, new Error("No matching guild"));
                  return;
              }
              await guild.commands.set(toRegister);
          }
          // Throw an error
          else {
              throw new Error("Did you provide a valid guildId to register interactions");
          }

          this.logger.success("Successfully registered interactions");
      } catch (error) {
          this.logger.error(`Failed to register interactions: ${error.message}`, error);
      }
  }

  /**
   * @param {string} search
   * @param {Boolean} exact
   */
  async resolveUsers(search, exact = false) {
      if (!search || typeof search !== "string") return [];
      const users = [];

      // Check if userId is passed
      const patternMatch = search.match(/(\d{17,20})/);
      if (patternMatch) {
          const id = patternMatch[1];
          const fetched = await this.users.fetch(id, { cache: true }).catch(() => {}); // Check if mentions contains the ID
          if (fetched) {
              users.push(fetched);
              return users;
          }
      }

      // Check if exact tag is matched in cache
      const matchingTags = this.users.cache.filter((user) => user.tag === search);
      if (exact && matchingTags.size === 1) users.push(matchingTags.first());
      else matchingTags.forEach((match) => users.push(match));

      // Check matching username
      if (!exact) {
          this.users.cache
              .filter(
                  (x) =>
                      x.username === search ||
                      x.username.toLowerCase().includes(search.toLowerCase()) ||
                      x.tag.toLowerCase().includes(search.toLowerCase())
              )
              .forEach((user) => users.push(user));
      }

      return users;
  }

  /**
   * Get bot's invite
   */
  getInvite() {
      return this.generateInvite({
          scopes: ["bot", "applications.commands"],
          permissions: [
              "AddReactions",
              "AttachFiles",
              "BanMembers",
              "ChangeNickname",
              "Connect",
              "DeafenMembers",
              "EmbedLinks",
              "KickMembers",
              "ManageChannels",
              "ManageGuild",
              "ManageMessages",
              "ManageNicknames",
              "ManageRoles",
              "ModerateMembers",
              "MoveMembers",
              "MuteMembers",
              "PrioritySpeaker",
              "ReadMessageHistory",
              "SendMessages",
              "SendMessagesInThreads",
              "Speak",
              "ViewChannel",
          ],
      });
  }
};