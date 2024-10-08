const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  ButtonStyle,
} = require("discord.js");
const auth = require("./auth.json");
const fs = require("fs");
const { openDb } = require("./databaseHandler.js");
const servers = require("./servers");
const fetch = require("node-fetch");

let db;

// Initialize Discord Bot
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.DirectMessages,
];
const partials = [Partials.GuildMember, Partials.Channel];

const client = new Client({
  intents: intents,
  partials: partials,
});

client.on("ready", async () => {
  // open database
  db = await openDb();

  // create all the tables if they have not yet been created
  const schema = fs.readFileSync("./database/schema.sql").toString();
  const schemaArr = schema.toString().split(");");

  db.getDatabaseInstance().serialize(() => {
    db.run("PRAGMA foreign_keys=OFF;");
    schemaArr.forEach((query) => {
      if (query) {
        query += ");";
        db.run(query);
      }
    });
  });

  // const button = new ActionRowBuilder().addComponents(
  //   new ButtonBuilder()
  //     .setCustomId(`RETRY dummyval`)
  //     .setLabel("Retry")
  //     .setStyle(ButtonStyle.Success)
  // );

  // const channel = await client.channels.fetch("1011279001412714548");
  // channel.send({
  //   embeds: [
  //     {
  //       description: `If your DM permissions were off and you have fixed them, press the button below:`,
  //       color: 0x00274c,
  //     },
  //   ],
  //   components: [button],
  // });

  console.log(`Logged in as ${client.user.tag}!`);
});

client.on("guildMemberAdd", async function (member) {
  let sql = `INSERT INTO users (userid, stage, name, uniqname, serverid) VALUES (?, 0, "", "", ?)`;
  await db.run(sql, [member.id, member.guild.id]);

  const serverInfo = servers[member.guild.id];

  member
    .send({
      embeds: [
        {
          description: `Welcome to the ${serverInfo.name} server! Please fill out these quick questions so we can verify you're a real person.`,
          color: 0x00274c,
        },
        {
          description: `1) What is your full name (first and last)?`,
          color: 0x00274c,
        },
      ],
    })
    .catch(() => {
      let sql = `DELETE FROM users WHERE userid = ?`;
      db.run(sql, [member.id]);
    });
});

client.on("messageCreate", async function (message) {
  let sql = `SELECT stage, serverid FROM users WHERE userid = ?`;
  let data = await db.get(sql, [message.author.id]);
  if (message.guild !== null || !data) {
    return;
  }

  serverInfo = servers[data.serverid];

  switch (data.stage) {
    case 0:
      sql = `UPDATE users SET stage = 1, name = ? WHERE userid = ?`;
      db.run(sql, [message.content, message.author.id]);
      message.author.send({
        embeds: [
          {
            description: `2) What is your uniqname? If you are not a UMich student, please state your affiliation with ${serverInfo.name}.`,
            color: 0x00274c,
          },
        ],
      });
      break;
    case 1:
      sql = `UPDATE users SET stage = 2, uniqname = ? WHERE userid = ?`;
      await db.run(sql, [message.content, message.author.id]);
      sql = `SELECT userid, name, uniqname FROM users WHERE userid = ?`;
      data = await db.get(sql, [message.author.id]);
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`CONFIRM ${data.userid} confirm`)
          .setLabel("Confirm")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`CONFIRM ${data.userid} cancel`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger)
      );
      message.author.send({
        embeds: [
          {
            description: `Thanks! Please verify that this information looks correct:`,
            color: 0x00274c,
            fields: [
              {
                name: `1) What is your full name (first and last)?`,
                value: data.name,
              },
              {
                name: `2) What is your uniqname?`,
                value: data.uniqname,
              },
            ],
          },
        ],
        components: [buttons],
      });
      break;
  }
});

client.on("interactionCreate", async function (interaction) {
  if (interaction.isButton()) {
    const { customId } = interaction;
    const split = customId.split(" ");
    const userid = split[1];
    let sql = ``;

    switch (split[0]) {
      case "CONFIRM":
        if (split[2] == "confirm") {
          interaction.channel.send({
            embeds: [
              {
                description: `Thanks for filling out the survey! You will be verified shortly.`,
                color: 0x00274c,
              },
            ],
          });

          interaction.update({
            components: [],
          });

          sql = `SELECT userid, name, uniqname, serverid FROM users WHERE userid = ?`;
          let data = await db.get(sql, [userid]);

          const serverInfo = servers[data.serverid];

          let matchState = "no match";
          try {
            const res = await fetch(
              `https://mcommunity.umich.edu/api/people/${data.uniqname}/`
            );
            const body = await res.text();
            const jsonBody = JSON.parse(body);

            if (jsonBody["givenName"]) {
              const mcommName =
                jsonBody["givenName"]?.toLowerCase() +
                jsonBody["surname"]?.toLowerCase();
              const surveyName = data.name.toLowerCase().split(" ").join("");
              if (mcommName === surveyName) {
                matchState = "matched";
              }
            } else {
              matchState = "not found";
            }
          } catch (e) {
            matchState = "failed";
            console.error(e)
          }

          let fieldMatch = undefined;
          switch (matchState) {
            case "matched":
              fieldMatch = {
                name: "MCommunity Verification",
                value: `✅ Name matches uniqname on MCommunity ✅\n➡️ https://mcommunity.umich.edu/?value=${data.uniqname}`,
              };
              break;
            case "no match":
              fieldMatch = {
                name: "MCommunity Verification",
                value: `⚠️ Uniqname does not match name on MCommunity, please verify carefully ⚠️\n➡️ https://mcommunity.umich.edu/?value=${data.uniqname}`,
              };
              break;
            case "not found":
              fieldMatch = {
                name: "MCommunity Verification",
                value: `❌ Uniqname was not found on MCommunity, please verify carefully ❌\n➡️ https://mcommunity.umich.edu/?value=${data.uniqname}`,
              };
              break;
            default:
              fieldMatch = {
                name: "MCommunity Verification",
                value: `❌ MCommunity verification failed to complete, please verify manually ❌\n➡️ https://mcommunity.umich.edu/?value=${data.uniqname}`,
              };
              break;
          }

          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`VERIFY ${data.userid} admit`)
              .setLabel("Admit")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`VERIFY ${data.userid} kick`)
              .setLabel("Kick")
              .setStyle(ButtonStyle.Danger)
          );

          const channel = await client.channels.fetch(
            serverInfo.verificationChannel
          );
          channel.send({
            embeds: [
              {
                description: `Please verify this user to admit or kick them from the server:`,
                color: 0x00274c,
                fields: [
                  {
                    name: `User:`,
                    value: `<@!${data.userid}>`,
                  },
                  {
                    name: `Full name:`,
                    value: data.name,
                  },
                  {
                    name: `Uniqname`,
                    value: data.uniqname,
                  },
                  fieldMatch,
                ],
              },
            ],
            components: [buttons],
          });
        } else if (split[2] === "cancel") {
          let sql = `UPDATE users SET stage = 0, name = "", uniqname = "" WHERE userid = ?`;
          db.run(sql, [userid]);

          interaction.channel.send({
            embeds: [
              {
                description: `Okay, restarting the survey.`,
                color: 0x00274c,
              },
              {
                description: `1) What is your full name (first and last)?`,
                color: 0x00274c,
              },
            ],
          });

          interaction.update({
            components: [],
          });
        }
        break;
      case "VERIFY":
        if (split[2] === "admit") {
          const serverInfo = servers[interaction.guild.id];
          let role = await interaction.guild.roles.cache.find(
            (r) => r.id === serverInfo.roleId
          );

          const member = await interaction.guild.members.fetch({
            user: userid,
            force: true,
          });
          member.roles.add(role).catch(() => {
            client.channels
              .fetch(serverInfo.verificationChannel)
              .then((channel) => {
                channel.send({
                  embeds: [
                    {
                      description: `Something went wrong when assigning roles to <@!${member.id}>! Please double check and correct their roles.`,
                      color: 0xb83a36,
                    },
                  ],
                });
              });
          });

          sql = `SELECT name, serverid FROM users WHERE userid = ?`;
          let data = await db.get(sql, [userid]);

          member.setNickname(data.name).catch((e) => {
            console.log(e);
            client.channels
              .fetch(serverInfo.verificationChannel)
              .then((channel) => {
                channel.send({
                  embeds: [
                    {
                      description: `Something went wrong when changing <@!${member.id}>'s nickname! Please double check and correct their nickname.`,
                      color: 0xb83a36,
                    },
                  ],
                });
              });
          });

          member.send({
            embeds: [
              {
                description: `You have been admitted to the ${serverInfo.name} server!`,
                color: 0x228b22,
              },
            ],
          });

          let embed = interaction.message.embeds[0];
          const newEmbed = new EmbedBuilder()
            .setColor(0x228b22)
            .setDescription("This user has been verified!")
            .addFields(embed.fields);
          interaction.update({
            embeds: [newEmbed],
            components: [],
          });
        } else if (split[2] === "kick") {
          const member = interaction.guild.members.cache.get(userid);

          const serverInfo = servers[interaction.guild.id];

          member.kick();
          member.send({
            embeds: [
              {
                description: `A verifier denied your survey and you were removed from the server. If you think something is wrong, rejoin the server at this link: ${serverInfo.inviteLink}`,
                color: 0xb83a36,
              },
            ],
          });

          let embed = interaction.message.embeds[0];
          const newEmbed = new EmbedBuilder()
            .setColor(0xb83a36)
            .setDescription("This user was rejected.")
            .addFields(embed.fields);
          interaction.update({
            embeds: [newEmbed],
            components: [],
          });
        }
        sql = `DELETE FROM users WHERE userid = ?`;
        db.run(sql, [userid]);
        break;
      case "RETRY":
        sql = `SELECT userid FROM users WHERE userid = ?`;
        let data = await db.get(sql, [interaction.user.id]);
        if (data) {
          interaction.reply({
            embeds: [
              {
                description: `It looks like you should have received a DM from me already. Please check again.`,
                color: 0x00274c,
              },
            ],
            ephemeral: true,
          });

          break;
        }

        sql = `INSERT INTO users (userid, stage, name, uniqname, serverid) VALUES (?, 0, "", "", ?)`;
        await db.run(sql, [interaction.user.id, interaction.guild.id]);

        try {
          await interaction.user.send({
            embeds: [
              {
                description: `Welcome to the ${serverInfo.name} server! Please fill out these quick questions so we can verify you're a real person.`,
                color: 0x00274c,
              },
              {
                description: `1) What is your full name (first and last)?`,
                color: 0x00274c,
              },
            ],
          });

          interaction.reply({
            embeds: [
              {
                description: `Verification was sent! Check your DMs for a message from me.`,
                color: 0x228b22,
              },
            ],
            ephemeral: true,
          });
        } catch {
          interaction.reply({
            embeds: [
              {
                description: `It looks like your privacy settings still aren't fixed. Please double check that you are allowing DMs from server members, and try again.`,
                color: 0xb83a36,
              },
            ],
            ephemeral: true,
          });
          let sql = `DELETE FROM users WHERE userid = ?`;
          db.run(sql, [interaction.user.id]);
          break;
        }

        break;
    }
  }
});

client.on("guildMemberRemove", async function (member) {
  let sql = `DELETE FROM users WHERE userid = ?`;
  db.run(sql, [member.id]);
});

client.login(auth.token);
