# fleet-bot-deno

Deno Deploy Telegram bot. Storage: Deno KV only. Files stored as Telegram file_id and proxied via /file/<file_id>.

## Files
- main.ts — webhook and logic
- deno.json — entrypoint config

## Deploy
1. Push to GitHub repository.
2. Deno Deploy → New Project → pick repo.
3. Settings → Environment Variables:
   BOT_TOKEN
   DASHBOARD_URL
   TIMEZONE=America/Chicago
   REPORT_CHAT_ID=-1003162402009
   REPORT_THREAD_ID=122   # optional
4. Set webhook:
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.deno.dev/hook&drop_pending_updates=true
5. Cron (Project → Cron):
   Weekly: 0 14 * * 1 → POST https://<project>.deno.dev/cron-weekly
   Monthly: 5 14 1 * * → POST https://<project>.deno.dev/cron-monthly
