# How To Retrieve Telegram Environment Variables

This will walk you through the steps of getting a Telegram Bot API Token, needed for the environment variable `TELEGRAM_API_TOKEN`.

## Step 1 - Start Conversation With @BotFather

Go to [https://t.me/BotFather](https://t.me/BotFather) to start a conversation with `@BotFather`.

## Step 2 - Register New Bot

While in the conversation with `@BotFather`, send the following command:

```bash
/newbot

# [Expected Prompts]
# Alright, a new bot. How are we going to call it? Please choose a name for your bot.
#
# > My New Bot
#
# Good. Now let's choose a username for your bot. It must end in `bot`. Like this, for example: TetrisBot or tetris_bot.
#
# > myTestFaucettBot
#
# Done! Congratulations on your new bot. You will find it at t.me/myTestFaucettBot. You can now add a description, about section and profile picture for your bot, see /help for a list of commands. By the way, when you've finished creating your cool bot, ping our Bot Support if you want a better username for it. Just make sure the bot is fully operational before you do this.
#
# Use this token to access the HTTP API:
# <YOUR_TELEGRAM_API_TOKEN - Example 1234567890:ABCDEFGHIGKLMNOPQRSTUVWXYZ123456789>
# Keep your token secure and store it safely, it can be used by anyone to control your bot.
#
# For a description of the Bot API, see this page: https://core.telegram.org/bots/api
```

Made a mistake? Start over by deleting your bot.

```bash
/deletebot

# [Expected Prompts]
# Choose a bot to delete.
#
# > myTestFaucettBot
#
# OK, you selected @myTestFacuetBot. Are you sure?
#
# Send 'Yes, I am totally sure.' to confirm you really want to delete this bot.
#
# > Yes, I am totally sure.
#
# Done! The bot is gone. /help
```

## Step 3 - Set Environment Variables

Use your newly created bot's `TELEGRAM_API_TOKEN` (Ex: `1234567890:ABCDEFGHIGKLMNOPQRSTUVWXYZ123456789`) wherever `.dev.vars` or `.env` is needed.
