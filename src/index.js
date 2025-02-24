require("dotenv").config();
require("module-alias/register");

// register extenders
require("@helpers/extenders/Message");
require("@helpers/extenders/Guild");
require("@helpers/extenders/GuildChannel");

const { checkForUpdates } = require("@helpers/BotUtils");
const { initializeMongoose } = require("@src/database/mongoose");
const { BotClient } = require("@src/structures");
const { validateConfiguration } = require("@helpers/Validator");
const { Client, GatewayIntentBits } = require('discord.js'); // Correct import for Intents
const config = require('../config.js');

validateConfiguration();

// initialize client
const client = new BotClient();
client.loadCommands("src/commands");
client.loadContexts("src/contexts");
client.loadEvents("src/events");

// find unhandled promise rejections
process.on("unhandledRejection", (err) => client.logger.error(`Unhandled exception`, err));

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] }); // Correct usage of Intents

discordClient.once('ready', () => {
  console.log(`Logged in as ${discordClient.user.tag}!`);

  if (config.PRESENCE.ENABLED) {
    const updatePresence = () => {
      const members = discordClient.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
      const servers = discordClient.guilds.cache.size;
      const statusMessage = config.PRESENCE.MESSAGE.replace('{members}', members).replace('{servers}', servers);

      discordClient.user.setPresence({
        status: config.PRESENCE.STATUS,
        activities: [{
          name: statusMessage,
          type: config.PRESENCE.TYPE,
        }],
      });
    };

    // Update presence immediately on startup
    updatePresence();

    // Set interval to update presence every 2 minutes
    setInterval(updatePresence, config.PRESENCE.UPDATE_INTERVAL);
  }
});

(async () => {
  // check for updates
  await checkForUpdates();

  // start the dashboard
  if (client.config.DASHBOARD.enabled) {
    client.logger.log("Launching dashboard");
    try {
      const { launch } = require("@root/dashboard/app");

      // let the dashboard initialize the database
      await launch(client);
    } catch (ex) {
      client.logger.error("Failed to launch dashboard", ex);
    }
  } else {
    // initialize the database
    await initializeMongoose();
  }

  // start the client
  await client.login(process.env.BOT_TOKEN);
})();
