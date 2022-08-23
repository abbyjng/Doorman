const { Client, GatewayIntentBits, Partials } = require("discord.js");
const auth = require("./auth.json");
const fs = require("fs");
var sqlite3 = require("sqlite3").verbose();
var file = "./database/database.db";
let db = new sqlite3.Database(file);

// Initialize Discord Bot
const intents = [
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.MessageContent,
];

const partials = [Partials.GuildMember, Partials.Channel];

const client = new Client({
  intents: intents,
  partials: partials,
});

client.on("ready", async () => {
  // create all the tables if they have not yet been created
  const schema = fs.readFileSync("./database/schema.sql").toString();
  const schemaArr = schema.toString().split(");");

  // db.getDatabaseInstance().serialize(() => {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys=OFF;");
    schemaArr.forEach((query) => {
      if (query) {
        query += ");";
        db.run(query);
      }
    });
  });

  console.log(`Logged in as ${client.user.tag}!`);
});

client.on("guildMemberAdd", async function (member) {
  let sql = `INSERT INTO users (userid, stage, name, uniqname) VALUES (?, 0, "", "") RETURNING *`;
  db.run(sql, [member.id], (err, row) => {
    console.log(row.userid);
  });

  member.send({
    embeds: [
      {
        description: `Welcome to the AIV server! Please fill out these quick questions so we can verify you're a real person.`,
        color: 0x00274c,
      },
      {
        description: `What is your full name (first and last)?`,
        color: 0x00274c,
      },
    ],
  });
});

client.on("messageCreate", async function (message) {
  let sql = `SELECT stage FROM users WHERE userid = ?`;
  let data = await db.run(sql, [message.author.id]);

  let x = await db.run(`SELECT userid FROM users`);

  console.log("hello from messageCreate!");
  console.log(data.stage);
  console.log(message.author.id);
  console.log(x.userid);
  // console.log(x.userid);
  // console.log(message.author.id === x.userid);

  if (data) {
    switch (data.stage) {
      case 0:
        sql = `UPDATE users SET stage = 1, name = ? WHERE userid = ?`;
        db.run(sql, [message.content, message.author.id]);
        message.author.send({
          embeds: [
            {
              description: `2) What is your uniqname?`,
              color: 0x00274c,
            },
          ],
        });
        break;
      case 1:
        sql = `UPDATE users SET stage = 2, uniqname = ? WHERE userid = ? RETURNING *`;
        data = db.run(sql, [message.content, message.author.id]);
        const buttons = new MessageActionRow().addComponents(
          new MessageButton()
            .setCustomId(`CONFIRM confirm ${data.userid}`)
            .setLabel("Confirm")
            .setStyle("SUCCESS"),
          new MessageButton()
            .setCustomId(`CONFIRM cancel ${data.userid}`)
            .setLabel("Cancel")
            .setStyle("DANGER")
        );
        message.author.send({
          embeds: [
            {
              description: `Thanks! Please verify that this information looks correct:`,
              color: 0x00274c,
              fields: [
                {
                  name: `What is your full name (first and last)?`,
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
  }
});

client.on("interactionCreate", async function (interaction) {
  if (interaction.isButton()) {
    const { customId } = interaction;
    const split = customId.split(" ", 2);
    const userid = split[2];

    switch (split[0]) {
      case "CONFIRM":
        if (split[1] == "confirm") {
          interaction.channel.send({
            embeds: [
              {
                description: `Thanks for filling out the survey! You will be verified soon.`,
                color: 0x00274c,
              },
            ],
          });

          let sql = `SELECT userid, name, uniqname FROM users WHERE userid = ?`;
          let data = await db.run(sql, [userid]);

          const buttons = new MessageActionRow().addComponents(
            new MessageButton()
              .setCustomId(`VERIFY admit ${data.userid}`)
              .setLabel("Admit")
              .setStyle("SUCCESS"),
            new MessageButton()
              .setCustomId(`VERIFY kick ${data.userid}`)
              .setLabel("Kick")
              .setStyle("DANGER")
          );

          // TODO: update this channel id when added to the actual server
          const channel = client.channels.cache.get("1011353514544463874");
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
                ],
              },
            ],
            components: [buttons],
          });
        } else if (split[1] === "cancel") {
          sql = `UPDATE users SET stage = 0, name = "", uniqname = "" WHERE userid = ?`;
          db.run(sql, [userid]);
          interaction.user.send({
            embeds: [
              {
                description: `Okay, restarting the survey.`,
                color: 0x00274c,
              },
              {
                description: `What is your full name (first and last)?`,
                color: 0x00274c,
              },
            ],
          });
        }
        break;
      case "VERIFY":
        if (split[1] === "admit") {
          const user = client.users.cache.get(userid);
          let role = interaction.guild.roles.find(
            (r) => r.id === "1011298638061899897"
          );
          user.addRole(role);
          user.send({
            embeds: [
              {
                description: `You have been admitted to the AIV server!`,
                color: 0x00274c,
              },
            ],
          });
        } else if (split[1] === "kick") {
          const user = client.users.cache.get(userid);
          user.kick();
          user.send({
            embeds: [
              {
                description: `A verifier denied your survey and you were removed from the server. If you think something is wrong, rejoin the server at this link: https://discord.gg/NTZASbnCCM`,
                color: 0x00274c,
              },
            ],
          });
        }
        let sql = `DELETE FROM users WHERE userid = ?`;
        db.run(sql, [userid]);
        break;
    }
  }
});

client.login(auth.token);
