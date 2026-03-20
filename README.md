# BizWiz — AI Strategy Consultant

Your pocket McKinsey. Ask any business question and get consulting-grade answers powered by Claude, structured around real frameworks from McKinsey, Bain, BCG, and Deloitte.

## Features

- 💬 **Chat mode** — Quick conversational answers with ELI5 plain-English breakdown
- 📄 **Strategy Report** — Full 7-section consulting document with export (TXT, PDF, CSV, Email)
- 🏢 **4 consultant personas** — McKinsey, Bain, BCG, Deloitte
- 💾 **Save profile** — Business context persists in browser localStorage
- 📱 **Mobile friendly** — Responsive, no zoom on iOS inputs
- 🌙 **Dark / light mode**
- 🎭 **Sample businesses** — Krusty Burger, Acme Corp, Stark Industries, Pawnee Parks

---

## Deploy to Vercel (5 minutes)

### 1. Clone and push to GitHub

```bash
git clone https://github.com/YOUR_USERNAME/bizwiz.git
cd bizwiz
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your `bizwiz` GitHub repository
3. Leave all build settings as default (Vercel auto-detects from `vercel.json`)
4. Click **Deploy**

### 3. Add your Anthropic API key

1. In your Vercel project → **Settings** → **Environment Variables**
2. Add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-...` (your key from [console.anthropic.com](https://console.anthropic.com))
   - **Environments:** Production, Preview, Development ✓ all three
3. Click **Save**
4. Go to **Deployments** → **Redeploy** (environment variables require a redeploy)

### 4. Done ✓

Your app is live at `https://bizwiz-YOUR_USERNAME.vercel.app`

---

## Local Development

```bash
npm i -g vercel
vercel dev
```

Then visit `http://localhost:3000`

> You'll need a `.env.local` file with `ANTHROPIC_API_KEY=sk-ant-...` for local dev.

---

## Project Structure

```
bizwiz/
├── public/
│   └── index.html        # Full frontend (single file)
├── api/
│   └── chat.js           # Serverless proxy — keeps API key server-side
├── vercel.json           # Routing config
├── .gitignore
└── README.md
```

---

## Updating the App

Any push to `main` auto-deploys via Vercel:

```bash
git add .
git commit -m "Your change description"
git push origin main
```

Vercel builds and deploys in ~30 seconds.

---

## Cost Control

Set a monthly spend cap in the [Anthropic console](https://console.anthropic.com) to avoid surprises.

Typical costs with Claude Sonnet 4:
- Chat message: ~$0.01
- Strategy report: ~$0.10
- 50 chats + 10 reports/month: ~$2

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (single file, no build step)
- **Backend:** Vercel serverless function (Node.js)
- **AI:** Claude Sonnet 4 via Anthropic API
- **Hosting:** Vercel

---

*BizWiz is for educational and exploratory purposes only. Not a substitute for professional business, legal, or financial advice.*
