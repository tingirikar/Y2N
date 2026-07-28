# Y2N — YouTube to Notion Playlist Tracker

> Track your YouTube playlists in Notion. Paste a link, get a page added to your database with every video as a trackable to-do checkbox.

## ✨ Features

- 🎬 **Paste & Sync** — Drop a YouTube playlist URL, get a page in your Notion database
- ☑️ **To-Do Tracking** — Each video is a checkbox inside the page: `☐ 1. ▶ Channel VideoTitle`
- 📊 **Status Tracking** — Pages have Number and Status (Not started / In progress / Done)
- 🔗 **Linked Videos** — Click any video title to open it directly on YouTube
- 🎨 **Premium UI** — Dark theme with glassmorphism and smooth animations

## 🚀 Quick Start

### 1. Set Up Notion

Create a database in Notion with these columns:

| Column | Type | Required |
|--------|------|----------|
| Name | Title | ✅ Yes |
| Number | Number | ✅ Yes |
| Status | Status | ✅ Yes (with "Not started" option) |

> **Important:** Share the database with your integration! Click "•••" → "Connections" → Add your integration.

### 2. Get API Keys

| Key | Where to get it |
|-----|-----------------|
| YouTube Data API v3 | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — Enable "YouTube Data API v3" |
| Notion Integration Token | [Notion Developers](https://developers.notion.com/) — Create an internal integration |
| Notion Database ID | Open your database in Notion → Copy link → Extract the ID from the URL (the 32-char hex string) |

### 3. Install & Run

```bash
cd Y2N

# Install dependencies
npm install

# (Optional) Create .env from template
cp .env.example .env
# Edit .env with your keys — OR enter them in the app's Settings UI

# Start the server
npm run dev
```

### 4. Open & Sync

1. Open [http://localhost:3000](http://localhost:3000)
2. Click ⚙️ **Settings** and enter your API keys + Database ID
3. Paste a YouTube playlist URL
4. Click **Sync to Notion** — a new page appears in your database! 🎉

## 📁 Project Structure

```
Y2N/
├── server.js          # Express backend (YouTube + Notion APIs)
├── package.json       # Dependencies and scripts
├── .env.example       # Environment variable template
├── .gitignore
├── README.md
└── public/
    ├── index.html     # Frontend page
    ├── style.css      # Premium dark theme
    └── app.js         # Client-side logic
```

## 🗃️ How It Looks in Notion

```
Your Database (e.g., "ytpt")
├── stack           | #1 | Not started
├── binary search   | #2 | Not started
├── sliding window  | #3 | Not started
└── ...
```

Inside each page (e.g., "stack"):
```
☐ 1. ▶ Aditya Verma  Stack Introduction And Identification
☐ 2. ▶ Aditya Verma  Delete Middle Element Of Stack
☐ 3. ▶ Aditya Verma  Reverse A String Using Stack
...
```

Each video title links directly to the YouTube video!

## License

MIT
