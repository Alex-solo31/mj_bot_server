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

async function pbLogin() {
  if (!POCKETBASE_URL) {
    console.error("❌ POCKETBASE_URL est vide ou non définie");
    throw new Error("POCKETBASE_URL manquante");
  }

  // On nettoie l'URL au cas où il y ait un / en trop à la fin
  const baseUrl = POCKETBASE_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/admins/auth-with-password`;

  console.log("🔗 PB login URL utilisée :", url);

  try {
    const res = await axios.post(url, {
      identity: POCKETBASE_ADMIN,
      password: POCKETBASE_PASS,
    });

    console.log("✅ PocketBase login OK, status :", res.status);
    return res.data.token;
  } catch (err) {
    console.error("💥 PocketBase login ERROR :", {
      url,
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    throw err;
  }
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
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: "Tu es un MJ chaleureux." },
      { role: "user", content: msg.content }
    ]
  });

  msg.reply(completion.choices[0].message.content);
});

// ---- START ----
client.login(DISCORD_TOKEN);
