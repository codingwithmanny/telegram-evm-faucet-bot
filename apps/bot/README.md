
# Telegram Bot

```bash
./node_modules/.bin/wrangler publish;

# [Expected Output]:
# ✔ Would you like to continue? … yes
```

Set webhook

```bash
curl --location --request GET 'https://api.telegram.org/bot<YOUR_TELEGRAM_API_TOKEN>/setWebhook' \
--header 'Content-Type: application/json' \
--data '{
    "url": "<YOUR_CLOUDFLARE_WORKER_BOT_URL>"
}'
```