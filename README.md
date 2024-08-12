# Telegram EVM Faucet Bot

A Telegram bot using Cloudflare workers and Upstash to give users either native gas tokens or erc20 tokens.

## Requirements

- NVM or NodeJS `v20.14.0` or greater
- [Cloudflare Worker](https://workers.cloudflare.com) account
- [Upstash Redis](https://upstash.com/docs/redis/overall/getstarted) account
- [Upstash Qstash](https://upstash.com/docs/qstash/overall/getstarted) account

## Setup

Steps to get up and running:

### Step 1 - Install Dependencies

```bash
# FROM: ./telegram-evm-faucet-bot

pnpm install;

# [Expected Output]:
# Scope: all 3 workspace projects
# Lockfile is up to date, resolution step is skipped
# Already up to date
# Done in 1.9s
```

### Step 2 - Login To Cloudflare With Wrangler

### Step 3 - Configure Environment Variables

```bash
pnpm dlx wrangler secret put UPSTASH_QSTASH_TOKEN
```

### Step 4 - Deploy

## Local Developmenmt
