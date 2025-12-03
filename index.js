// =========================
// Imports & configuration
// =========================
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');

// --- Env vars (Render) ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const POCKETBASE_URL = process.env.POCKETBASE_URL; // ex: https://pocketbase-server-kzsv.onrender.com
const POCKETBASE_ADMIN = process.env.POCKETBASE_ADMIN; // email admin PB
const POCKETBASE_PASS = process.env.POCKETBASE_PASS; // mdp admin PB

if (!DISCORD_TOKEN || !OPENAI_API_KEY) {
  console.error('❌ Missing DISCORD_TOKEN or OPENAI_API_KEY env vars');
  process.exit(1);
}
if (!POCKETBASE_URL || !POCKETBASE_ADMIN || !POCKETBASE_PASS) {
  console.error('❌ Missing PocketBase env vars (POCKETBASE_URL / POCKETBASE_ADMIN / POCKETBASE_PASS)');
  process.exit(1);
}

// =========================
// PocketBase client
// =========================
const pb = axios.create({
  baseURL: POCKETBASE_URL,
  timeout: 10000,
});

let pbToken = null;

// --- Login admin PocketBase ---
async function pbLogin() {
  try {
    const res = await axios.post(
      `${POCKETBASE_URL}/api/admins/auth-with-password`,
      {
        identity: POCKETBASE_ADMIN,
        password: POCKETBASE_PASS,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    pbToken = res.data.token;
    pb.defaults.headers.common['Authorization'] = `Bearer ${pbToken}`;
    console.log('✅ PB login OK');
    return pbToken;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('❌ PB login ERROR:', status, data || err.message);
    throw err;
  }
}

// --- Helper pour s’assurer qu’on est loggé ---
async function ensurePbAuth() {
  if (!pbToken) {
    await pbLogin();
  }
}

// =========================
// Discord client
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// =========================
// OpenAI client
// =========================
const openai = axios.create({
  baseURL: 'https://api.openai.com/v1',
  headers: {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

// Prompt MJ (version compacte, on l’étoffera après si tu veux)
const SYSTEM_PROMPT = `
Tu es un maître de jeu (MJ) pour un jeu de rôle textuel sur Discord.
- Style cinématographique, descriptions courtes (3–5 lignes), pas de pavés.
- Tu ne joues JAMAIS à la place du joueur, tu décris le monde et les PNJ.
- Monde cohérent, PNJ avec une personnalité stable, qui se souviennent des actions du joueur.
- Pas de gore, pas de contenu sexuel, pas de torture détaillée.
- Tu termines chaque tour par une courte question ou proposition d’action (max 7 mots).
Réponds toujours en français.
`;

// =========================
// PocketBase helpers (player + memory)
// =========================

// Récupère ou crée un player à partir du discord_id
async function getOrCreatePlayer(discordUser, campaignId = null) {
  await ensurePbAuth();

  const discordId = discordUser.id;
  const displayName = discordUser.username || discordUser.globalName || 'Joueur';

  // 1. chercher un player existant
  const filter = encodeURIComponent(`discord_id = "${discordId}"`);
  const url = `/api/collections/player/records?filter=${filter}&perPage=1`;

  const listRes = await pb.get(url);
  if (listRes.data?.items && listRes.data.items.length > 0) {
    return listRes.data.items[0];
  }

  // 2. sinon, créer
  const createBody = {
    discord_id: discordId,
    display_name: displayName,
  };

  const createRes = await pb.post('/api/collections/player/records', createBody);
  return createRes.data;
}

// Récupère la mémoire (derniers tours) pour un player
async function loadMemory(playerId, campaignId = null, limit = 20) {
  await ensurePbAuth();

  let filter = `player = "${playerId}"`;
  if (campaignId) {
    filter += ` && campaign = "${campaignId}"`;
  }

  const url = '/api/collections/memory/records';
  const res = await pb.get(url, {
    params: {
      filter,
      sort: 'created', // du plus ancien au plus récent
      perPage: limit,
    },
  });

  const items = res.data?.items || [];
  // chaque item.memory_content est du JSON (un ou plusieurs messages)
  const history = [];
  for (const item of items) {
    const content = item.content; // champ JSON dans PocketBase (nommé "content" chez nous)
    if (!content) continue;

    // on accepte soit un objet, soit un tableau d’objets
    if (Array.isArray(content)) {
      for (const msg of content) {
        if (msg.role && msg.content) {
          history.push({ role: msg.role, content: msg.content });
        }
      }
    } else if (content.role && content.content) {
      history.push({ role: content.role, content: content.content });
    }
  }

  return history;
}

// Sauvegarde le tour actuel dans la collection memory
async function saveTurn(playerId, campaignId, userContent, assistantContent) {
  await ensurePbAuth();

  const body = {
    player: playerId,
    campaign: campaignId || null,
    content: [
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
  };

  await pb.post('/api/collections/memory/records', body);
}

// =========================
// OpenAI call
// =========================
async function callOpenAI(userMessage, memoryMessages) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...memoryMessages,
    { role: 'user', content: userMessage },
  ];

  const res = await openai.post('/chat/completions', {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.8,
  });

  const answer = res.data.choices[0].message.content.trim();
  return answer;
}

// =========================
 // Discord events
// =========================

// Quand le bot est prêt
client.once('ready', async () => {
  console.log(`🤖 MJ BOT ONLINE en tant que ${client.user.tag}`);
  try {
    await pbLogin();
  } catch (e) {
    console.error('❌ Impossible de se connecter à PocketBase au démarrage.');
  }
});

// Réception des messages
client.on('messageCreate', async (msg) => {
  try {
    // ignore les bots et les DM si tu veux rester sur des salons
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const content = msg.content?.trim();
    if (!content) return;

    // (Optionnel) ne répondre que si on est mentionné
    // if (!msg.mentions.has(client.user)) return;

    // 1. player + (optionnel) campaign
    const player = await getOrCreatePlayer(msg.author);
    const campaignId = null; // on gérera les campagnes plus tard si tu veux

    // 2. charger la mémoire
    const memory = await loadMemory(player.id, campaignId);

    // 3. appel OpenAI
    const replyText = await callOpenAI(content, memory);

    // 4. envoyer la réponse sur Discord
    await msg.reply(replyText);

    // 5. sauvegarder le tour dans PocketBase
    await saveTurn(player.id, campaignId, content, replyText);
  } catch (err) {
    console.error('❌ Error in messageCreate handler:', err.response?.data || err.message);
    try {
      await msg.reply("Oups, j’ai eu un souci technique, réessaye dans un instant.");
    } catch (_) {
      // ignore
    }
  }
});

// =========================
// Start
// =========================
client.login(DISCORD_TOKEN).catch((err) => {
  console.error('❌ Discord login error:', err);
  // process.exit(1); // On bloque la mort du bot
});

