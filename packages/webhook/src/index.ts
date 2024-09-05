// Imports
// =================================
import { config } from "dotenv";

// Constants
// =================================
/**
 * @dev default Telegram API URL
 */
const TELEGRAM_API_URL = "https://api.telegram.org/bot";

// Config
// =================================
config();

// Main Script
// =================================
const main = async () => {
  console.group("Webhook script started!");

  if (
    !process.env.TELEGRAM_API_TOKEN ||
    !process.env.CLOUDFLARE_WORKER_BOT_URL
  ) {
    throw new Error("Missing required environment variables.");
  }

  // Set Webhook
  const url = `${TELEGRAM_API_URL}${process.env.TELEGRAM_API_TOKEN}`;
  let response = await fetch(`${url}/setWebhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: process.env.CLOUDFLARE_WORKER_BOT_URL,
    }),
  });

  console.log({ responseOk: response.ok });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  let json = await response.json();
  console.log(json);

  // Confirm Webhook
  response = await fetch(`${url}/getWebhookInfo`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  console.log({ responseOk: response.ok });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  json = await response.json();
  console.log(json);
};

// Init
// =================================
main()
  .then(() => {
    console.log("Webhook script complete!");
  })
  .catch((err) => {
    console.error(err);
  });
