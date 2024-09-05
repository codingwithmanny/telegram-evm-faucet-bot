# How To Retrieve Upstash Redis Environment Variables

This will walk you through the steps of getting the following environment variables from [Upstash Redis](https://console.upstash.com/redis).

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Step 1 - Sign Up For Upstash Account

Go to [https://console.upstash.com/login](https://console.upstash.com/login) and sign up for an account.

## Step 2 - Create New Redis Database

Go to [https://console.upstash.com/redis](https://console.upstash.com/redis) and click `+ Create Database`.

![Upstash Redis Create Database](./UPSTASH_REDIS_CREATE_DATABASE.png)

Enter a _Name_, _Primary Region_, and click `Next`

![Upstash Redis New Database Settings](./UPSTASH_REDIS_NEW_DATABASE_SETTINGS.png)

## Step 3 - Select Database Plan

Choose a plan and set a max budget.

![Upstash Redis New Database Plan](./UPSTASH_REDIS_NEW_DATABASE_PLAN.png)

## Step 4 - Retrieve UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN

Copy both the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

![Upstash Redis REST URL and REST TOKEN](./UPSTASH_REDIS_REST_URL_REST_TOKEN.png)

## Step 5 - Set Environment Variables

Update `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` wherever `.dev.vars` or `.env` is needed.
