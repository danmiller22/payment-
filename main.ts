import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const CHAT_ID = Deno.env.get("CHAT_ID");
const PAYMENT_URL =
  Deno.env.get("PAYMENT_URL") ??
  "https://qr.finik.kg/c1b526b5-040b-4eca-9017-6df94e6f8d71?type=t";
const SUPPORT_USERNAME = Deno.env.get("SUPPORT_USERNAME") ?? "kghome_support";
const CRON_SECRET = Deno.env.get("CRON_SECRET");

if (!BOT_TOKEN || !CHAT_ID || !CRON_SECRET) {
  console.error("Missing required env vars: BOT_TOKEN, CHAT_ID, CRON_SECRET");
}

const API_ROOT = `https://api.telegram.org/bot${BOT_TOKEN}`;

const MESSAGE_TEXT = [
  "Дорогие друзья!",
  "",
  "Все квартиры с номерами хозяев находятся в нашей закрытой группе.",
  "Теперь подписка навсегда оформляется по системе 50/50 и стоит всего 1500 сом.",
  "",
  "750 сом вы оплачиваете перед вступлением в группу и ещё 750 сом – после того, как найдёте через нас квартиру.",
  "",
  "В день в закрытой группе публикуется до 100 новых, бюджетных квартир. В среднем жильё находится за 1–3 дня.",
  "",
  "1) Оплатите первую часть подписки — 750 сом — по кнопке ниже.",
  "2) Ознакомьтесь и подпишите договор: kghome.deno.dev",
  "3) После первой оплаты прикрепите, пожалуйста, чек в договоре и подпишите его.",
  "4) После заселения внесите вторую часть — 750 сом — и также прикрепите чек.",
].join("\n");

function getKeyboard() {
  const supportUser = SUPPORT_USERNAME.replace(/^@/, "");
  return {
    inline_keyboard: [
      [
        {
          text: "Получить номера сейчас",
          url: PAYMENT_URL,
        },
        {
          text: "Связаться с техподдержкой",
          url: `https://t.me/${supportUser}`,
        },
      ],
    ],
  };
}

async function callTelegram(method: string, payload: Record<string, unknown>) {
  if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is not set");
    return;
  }
  const res = await fetch(`${API_ROOT}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("Telegram API error", method, await res.text());
  }
}

async function sendPaymentPost() {
  await callTelegram("sendMessage", {
    chat_id: CHAT_ID,
    text: MESSAGE_TEXT,
    reply_markup: getKeyboard(),
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}

async function handleUpdate(update: any) {
  try {
    const message = update.message;
    if (!message) return;

    const chat = message.chat;
    const chatType = chat?.type;

    // Полный игнор личных чатов
    if (chatType === "private") {
      return;
    }

    // В группах/супергруппах сейчас тоже ничего не отвечает.
    // Если захочешь реакции в группе — допишем тут логику.
    return;
  } catch (err) {
    console.error("handleUpdate error", err);
  }
}

serve(async (req: Request) => {
  const url = new URL(req.url);

  // Telegram webhook (корень)
  if (req.method === "POST") {
    const update = await req.json().catch(() => null);
    if (update) {
      await handleUpdate(update);
    }
    return new Response("OK");
  }

  // Эндпоинт для крон-запросов (автопост)
  if (req.method === "GET" && url.pathname === "/cron") {
    const secret = url.searchParams.get("secret");
    if (!CRON_SECRET || secret !== CRON_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
    await sendPaymentPost();
    return new Response("sent");
  }

  // Healthcheck
  if (req.method === "GET" && url.pathname === "/health") {
    return new Response("ok");
  }

  return new Response("Not found", { status: 404 });
});
