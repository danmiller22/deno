Telegram → Google Sheets + Drive bot on Deno Deploy. English UI. ReplyKeyboard flow.
This package embeds your Google service account in code for fast deploy.
SECURITY: Do not publish this repo publicly. Anyone with the key can access your Drive/Sheets.

## Deploy (fast)
1) Create a private GitHub repo. Upload the contents of this zip.
2) Deno Deploy → New Project → Link repo. Entrypoint: `src/main.ts`.
3) Set ENV in Deno Deploy (no need for GOOGLE_SA_JSON now):
   - TELEGRAM_TOKEN=...
   - SHEET_ID=...
   - DRIVE_FOLDER_ID=...
   - ALLOWED_CHAT_IDS=12345,-1001234567890:77
   - DASHBOARD_WEEKLY_URL=https://...
   - DASHBOARD_MONTHLY_URL=https://...
   - TZ=America/Chicago
4) Deploy. Then set Telegram webhook:
   https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=<DEPLOY_URL>/telegram
5) Share the Google Sheet and the Drive folder with the service account email in this package.
   Grant Editor.
6) Add Cron in Deno Deploy (Settings → Cron):
   - Route /cron/weekly, GET, 0 9 * * 1, Time zone America/Chicago
   - Route /cron/monthly, GET, 0 9 * * *, Time zone America/Chicago
