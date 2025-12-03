import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";
import OpenAI from "openai";

// ---- CONFIG ----
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;
const POCKETBASE_URL = process.env.PB_URL;
const POCKETBASE_ADMIN = process.env.PB_ADMIN;
const POCKETBASE_PASS = process.env.PB_PASS;

const ai = new OpenAI({ apiKey: OPENAI_KEY });

// ---- DISCORD BOT ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ---- PocketBase login ----
async function pbLogin() {
  const res = await axios.post(`${POCKETBASE_URL}/api/admins/auth-with-password`, {
    identity: POCKETBASE_ADMIN,
    password: POCKETBASE_PASS
  });
  return res.data.token;
}

// ---- When bot online ----
client.once("ready", () => {
  console.log("🤖 MJ BOT ONLINE");
});

// ---- Message handler ----
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const pbToken = await pbLogin();

  // GPT simple test
  const completion = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Tu es un MJ chaleureux." },
      { role: "user", content: msg.content }
    ]
  });

  msg.reply(completion.choices[0].message.content);
});

// ---- START ----
client.login(DISCORD_TOKEN);
