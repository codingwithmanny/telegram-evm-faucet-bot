// Imports
// =================================
import { config } from "dotenv";

// Constants
// =================================
/**
 * @dev default Telegram API URL
 */
const TELEGRAM_API_URL = "https://api.telegram.org/bot";

/**
 * @dev Standard messages
 */
const MESSAGES = {
  TELEGRAM: {
    SUCCESS: {
      OK: {
        text: "Commands set successfully!",
        status: 200,
      },
    },
    ERROR: {
      FAILED: {
        text: "Failed to set commands.",
        status: 500,
      },
      UNKNOWN: {
        text: "Error occurred while setting commands.",
        status: 500,
      },
    },
  },
};

// Config
// =================================
config();

// Main Script
// =================================
const main = async () => {
  console.group("Command script started!");

  try {
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
            commands: "superadmin",
            description: "Manage superadmin settings",
          },
        ],
        language_code: "en",
      }),
    });
    if (response.ok) {
      const json = await response.json();
      console.log(json);
      return new Response(MESSAGES.TELEGRAM.SUCCESS.OK.text, {
        status: MESSAGES.TELEGRAM.SUCCESS.OK.status,
      });
    }
    return new Response(MESSAGES.TELEGRAM.ERROR.FAILED.text, {
      status: MESSAGES.TELEGRAM.ERROR.FAILED.status,
    });
  } catch (error) {
    console.error(error);
    return new Response(MESSAGES.TELEGRAM.ERROR.UNKNOWN.text, {
      status: MESSAGES.TELEGRAM.ERROR.UNKNOWN.status,
    });
  }

  console.groupEnd();
};

// Init
// =================================
main()
  .then(() => {
    console.log("Command script complete!");
  })
  .catch((err) => {
    console.error(err);
  });
