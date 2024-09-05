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
  console.group("Command script started!");

  if (!process.env.TELEGRAM_API_TOKEN) {
    throw new Error("Missing required environment variables.");
  }

  const url = `${TELEGRAM_API_URL}${process.env.TELEGRAM_API_TOKEN}/setMyCommands`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      commands: [
        {
          command: "start",
          description: "Initialize superadmin first time",
        },
        {
          command: "rpc",
          description: "Retrieve and manage RPC settings",
        },
        {
          command: "admin",
          description: "Manage user admin roles",
        },
        {
          command: "status",
          description: "Retrieve token balances",
        },
        {
          command: "tokens",
          description: "Manage token settings",
        },
        {
          command: "send",
          description: "Send tokens to a user",
        },
        {
          command: "help",
          description: "See a full list of commands and examples",
        },
        {
          command: "superadmin",
          description: "Manage superadmin settings",
        },
        {
          command: "drip",
          description: "Send drip and manage drip settings",
        },
      ],
      language_code: "en",
    }),
  });
  console.log({ responseOk: response.ok });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const json = await response.json();
  console.log(json);
};

// Init
// =================================
main()
  .then(() => {
    console.log("Command script complete!");
  })
  .catch((error) => {
    console.error(error);
  });
