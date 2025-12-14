import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const CHAT_ID = Deno.env.get("CHAT_ID");
const PAYMENT_URL =
  Deno.env.get("PAYMENT_URL") ??
  "https://qr.finik.kg/c1b526b5-040b-4eca-9017-6df94e6f8d71?type=t";
const SUPPORT_URL =
  Deno.env.get("SUPPORT_URL") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET");

if (!BOT_TOKEN || !CHAT_ID || !CRON_SECRET) {
  console.error("Missing required env vars: BOT_TOKEN, CHAT_ID, CRON_SECRET");
}

const API_ROOT = `https://api.telegram.org/bot${BOT_TOKEN}`;

const MESSAGE_TEXT = [
  "Дорогие друзья!",
  "",
  "Все квартиры с номерами хозяев находятся в нашей закрытой группе.",
  "Мы работаем по честной системе — вы платите в основном за результат, а не за обещания.",
  "",
  "Подписка навсегда стоит всего 1000 сом:",
  "750 сом — перед вступлением в группу,",
  "250 сом — уже после того, как вы через нас найдёте квартиру и заселитесь.",
  "",
  "Каждый день в закрытой группе появляется до 100 новых, бюджетных квартир напрямую от хозяев.",
  "В среднем наши клиенты находят жильё за 1–3 дня.",
  "",
  "Оплатите первую часть подписки — 750 сом — по кнопке ниже и получите доступ к актуальной базе квартир.",
  "Ознакомьтесь и подпишите договор: kgzhome.deno.dev",
  "После оплаты прикрепите, пожалуйста, чек в договоре и подтвердите его.",
  "",
  "Вторую часть — 250 сом — вы оплачиваете только после заселения, также прикрепив чек.",
].join("\n");

function getKeyboard() {
  const keyboard: any = {
    inline_keyboard: [
      [
        {
          text: "Получить номера сейчас",
          url: PAYMENT_URL,
        },
      ],
    ],
  };

  // Если SUPPORT_URL не задан, не показываем кнопку техподдержки (и не светим ник).
  if (SUPPORT_URL) {
    keyboard.inline_keyboard.push([
      {
        text: "Связаться с техподдержкой",
        url: SUPPORT_URL,
      },
    ]);
  }

  return keyboard;
}

async function pinMessage(messageId: number) {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${API_ROOT}/pinChatMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      message_id: messageId,
      disable_notification: true,
    }),
  });
  if (!res.ok) {
    console.error("Telegram pinChatMessage error", await res.text());
  }
}

async function sendPaymentPost() {
  // Пытаемся отправить QR как фото, чтобы смотрелось лучше
  try {
    const qrRes = await fetch(PAYMENT_URL);
    if (!qrRes.ok) throw new Error(`QR fetch failed: ${qrRes.status}`);

    const qrBytes = new Uint8Array(await qrRes.arrayBuffer());
    const form = new FormData();
    form.append("chat_id", CHAT_ID!);
    form.append("caption", MESSAGE_TEXT);
    form.append("photo", new Blob([qrBytes]), "qr.png");
    form.append("reply_markup", JSON.stringify(getKeyboard()));

    const res = await fetch(`${API_ROOT}/sendPhoto`, {
      method: "POST",
      body: form,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      console.error("Telegram sendPhoto error", data ?? (await res.text()));
      throw new Error("sendPhoto failed");
    }

    const messageId = data.result?.message_id;
    if (messageId) {
      await pinMessage(messageId);
    }
    return;
  } catch (err) {
    console.error("Failed to send photo, fallback to sendMessage", err);
  }

  // Фолбэк: просто текст + кнопки, тоже с закреплением
  const res = await fetch(`${API_ROOT}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: MESSAGE_TEXT,
      reply_markup: getKeyboard(),
      disable_web_page_preview: false,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    console.error("Telegram sendMessage error", data ?? (await res.text()));
    return;
  }

  const messageId = data.result?.message_id;
  if (messageId) {
    await pinMessage(messageId);
  }
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

    // В группах бот тоже ни на что не отвечает — только автопостит по /cron
    return;
  } catch (err) {
    console.error("handleUpdate error", err);
  }
}

serve(async (req: Request) => {
  const url = new URL(req.url);

  // Telegram webhook
  if (req.method === "POST") {
    const update = await req.json().catch(() => null);
    if (update) {
      await handleUpdate(update);
    }
    return new Response("OK");
  }

  // Эндпоинт для автопостинга (крон)
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
