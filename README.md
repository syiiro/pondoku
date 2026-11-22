# Pondoku
    npm install && npm start     # http://localhost:3001
Admin login: admin@pondoku.my / admin123 (change it). Demo families: f1@demo.my … f11@demo.my / demo123.
Tiers: switch in the Coordinator view (Demo auto-joins; Pilot uses invite links + manual join/vote controls).

wa.js is the whatsapp bot logic

## WhatsApp bot (family chooses their group)

Files: `bot.js` (the bot's brain: what it says, the merit ranking, the choose/approve/reject flow), `wa.js` (connects to real WhatsApp), `public/bot.html` (simulator).

Flow: website form done → bot DMs the top 3 open groups (ranked by match %) → parent replies 1/2/3 → bot posts a Yes/No poll in that group → all Yes = parent joins · any No (or 48 h silence) = bot shows the remaining groups.

**Try it without WhatsApp:** `npm start`, open http://localhost:3001/bot.html, log in as admin, click **Reset bot demo**, pick **Lim**, click **Pretend they just registered**, reply `1`, then vote in the group chat on the right.

**Real WhatsApp:** in the Coordinator view switch to Prod mode, scan the QR shown in the terminal with a spare WhatsApp number (Linked devices). Each family needs their own real phone number. Groups must have been created by the bot (so it is admin and has the invite link).

Set `"flow": "auto"` in data.json to go back to the old automatic matching.
