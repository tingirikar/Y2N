require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Client } = require("@notionhq/client");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── YouTube Service ──────────────────────────────────────────────────────────

/**
 * Extract playlist ID from various YouTube URL formats:
 *   - https://www.youtube.com/playlist?list=PLxxxxxx
 *   - https://youtube.com/playlist?list=PLxxxxxx
 *   - https://www.youtube.com/watch?v=xxx&list=PLxxxxxx
 *   - PLxxxxxx (raw ID)
 */
function extractPlaylistId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Raw playlist ID
  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && !trimmed.includes(".")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("list");
  } catch {
    return null;
  }
}

/**
 * Fetch all videos from a YouTube playlist using the Data API v3.
 * Handles pagination automatically.
 */
async function fetchPlaylistVideos(playlistId, apiKey) {
  const BASE_URL = "https://www.googleapis.com/youtube/v3";
  let allItems = [];
  let nextPageToken = null;
  let playlistTitle = "YouTube Playlist";

  // First, get playlist metadata
  const metaUrl = `${BASE_URL}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    const err = await metaRes.json();
    throw new Error(
      `YouTube API error: ${err.error?.message || metaRes.statusText}`
    );
  }
  const metaData = await metaRes.json();
  if (metaData.items && metaData.items.length > 0) {
    playlistTitle = metaData.items[0].snippet.title;
  }

  // Fetch all playlist items with pagination
  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      playlistId: playlistId,
      maxResults: "50",
      key: apiKey,
    });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${BASE_URL}/playlistItems?${params}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(
        `YouTube API error: ${err.error?.message || res.statusText}`
      );
    }

    const data = await res.json();
    allItems = allItems.concat(data.items || []);
    nextPageToken = data.nextPageToken || null;
  } while (nextPageToken);

  // Map to clean video objects
  const videos = allItems
    .filter(
      (item) =>
        item.snippet.title !== "Private video" &&
        item.snippet.title !== "Deleted video"
    )
    .map((item, index) => ({
      position: index + 1,
      title: item.snippet.title,
      videoId: item.contentDetails.videoId,
      channel: item.snippet.videoOwnerChannelTitle || "Unknown",
      url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
    }));

  return { playlistTitle, videos, totalCount: videos.length };
}

// ─── Notion Service ───────────────────────────────────────────────────────────

/**
 * Get the next available number in the database by counting existing pages.
 */
async function getNextNumber(notion, databaseId) {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ property: "Number", direction: "descending" }],
      page_size: 1,
    });

    if (response.results.length > 0) {
      const topPage = response.results[0];
      const numProp = topPage.properties["Number"];
      if (numProp && numProp.number !== null) {
        return numProp.number + 1;
      }
    }
  } catch {
    // If "Number" property doesn't exist or query fails, start at 1
  }
  return 1;
}

/**
 * Add a playlist as a page in the user's existing database.
 *
 * - Page title = playlist title
 * - Page has Number and Status properties
 * - Inside the page body: each video is a to_do block
 *   formatted as: ☐ 1. 🔴 ChannelName  VideoTitle (linked to YouTube)
 */
async function addPlaylistToDatabase(
  notionApiKey,
  databaseId,
  playlistTitle,
  videos,
  onProgress
) {
  const notion = new Client({ auth: notionApiKey });

  // 1. Determine the next number
  onProgress?.({ step: "checking", message: "Checking database..." });
  const nextNum = await getNextNumber(notion, databaseId);

  // 2. Build to-do blocks for each video (max 100 per API call)
  const todoBlocks = videos.map((video) => ({
    object: "block",
    type: "to_do",
    to_do: {
      rich_text: [
        {
          type: "text",
          text: { content: `${video.position}. ` },
        },
        {
          type: "text",
          text: { content: `${video.channel} ` },
          annotations: { bold: true },
        },
        {
          type: "text",
          text: {
            content: video.title,
            link: { url: video.url },
          },
          annotations: { bold: true },
        },
      ],
      checked: false,
    },
  }));

  // 3. Create the page with the first batch of blocks (max 100)
  onProgress?.({
    step: "creating_page",
    message: `Creating page "${playlistTitle}"...`,
  });

  const firstBatch = todoBlocks.slice(0, 100);
  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    icon: { type: "emoji", emoji: "📺" },
    properties: {
      Name: {
        title: [{ text: { content: playlistTitle } }],
      },
      Number: { number: nextNum },
      Status: { status: { name: "Not started" } },
    },
    children: firstBatch,
  });

  // 4. If there are more than 100 videos, append remaining blocks in batches
  if (todoBlocks.length > 100) {
    for (let i = 100; i < todoBlocks.length; i += 100) {
      const batch = todoBlocks.slice(i, i + 100);
      const batchNum = Math.floor(i / 100) + 1;
      onProgress?.({
        step: "appending",
        message: `Adding videos batch ${batchNum}... (${Math.min(i + 100, todoBlocks.length)}/${todoBlocks.length})`,
        progress: Math.round((i / todoBlocks.length) * 100),
      });

      await notion.blocks.children.append({
        block_id: page.id,
        children: batch,
      });

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return {
    pageId: page.id,
    pageUrl: page.url,
    totalCreated: videos.length,
    number: nextNum,
  };
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Config status endpoint.
 * Tells the frontend which keys are already configured server-side in .env
 * so it doesn't nag the user to enter them again.
 */
app.get("/api/config-status", (req, res) => {
  res.json({
    hasYoutubeKey: !!process.env.YOUTUBE_API_KEY,
    hasNotionKey: !!process.env.NOTION_API_KEY,
    hasNotionDatabaseId: !!process.env.NOTION_DATABASE_ID,
    allConfigured:
      !!process.env.YOUTUBE_API_KEY &&
      !!process.env.NOTION_API_KEY &&
      !!process.env.NOTION_DATABASE_ID,
  });
});

/**
 * Main sync endpoint.
 * Body: { playlistUrl, youtubeApiKey?, notionApiKey?, notionDatabaseId? }
 * Keys from body override environment variables.
 */
app.post("/api/sync-playlist", async (req, res) => {
  try {
    const { playlistUrl } = req.body;

    // API keys: prefer body (from frontend), fall back to env vars
    const youtubeApiKey = req.body.youtubeApiKey || process.env.YOUTUBE_API_KEY;
    const notionApiKey = req.body.notionApiKey || process.env.NOTION_API_KEY;
    const notionDatabaseId =
      req.body.notionDatabaseId || process.env.NOTION_DATABASE_ID;

    // Validation
    if (!playlistUrl) {
      return res.status(400).json({ error: "Playlist URL is required" });
    }
    if (!youtubeApiKey) {
      return res.status(400).json({ error: "YouTube API key is required" });
    }
    if (!notionApiKey) {
      return res
        .status(400)
        .json({ error: "Notion integration token is required" });
    }
    if (!notionDatabaseId) {
      return res.status(400).json({ error: "Notion database ID is required" });
    }

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
      return res
        .status(400)
        .json({ error: "Could not extract playlist ID from the URL" });
    }

    console.log(`\n🎬 Syncing playlist: ${playlistId}`);

    // Step 1: Fetch videos from YouTube
    console.log("📡 Fetching videos from YouTube...");
    const { playlistTitle, videos, totalCount } = await fetchPlaylistVideos(
      playlistId,
      youtubeApiKey
    );
    console.log(`   Found ${totalCount} videos in "${playlistTitle}"`);

    if (totalCount === 0) {
      return res.status(404).json({
        error: "No videos found in this playlist. It may be private or empty.",
      });
    }

    // Step 2: Add as a page in the user's existing Notion database
    console.log("📝 Adding playlist page to Notion database...");
    const result = await addPlaylistToDatabase(
      notionApiKey,
      notionDatabaseId,
      playlistTitle,
      videos,
      ({ message }) => console.log(`   ${message}`)
    );

    console.log(`✅ Done! Added "${playlistTitle}" with ${result.totalCreated} videos.`);
    console.log(`   Notion URL: ${result.pageUrl}\n`);

    res.json({
      success: true,
      playlistTitle,
      totalVideos: totalCount,
      totalCreated: result.totalCreated,
      notionPageUrl: result.pageUrl,
      notionPageId: result.pageId,
      number: result.number,
    });
  } catch (err) {
    console.error("❌ Sync error:", err.message);
    res.status(500).json({
      error: err.message || "An unexpected error occurred during sync",
    });
  }
});

// Serve frontend for all non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Y2N server running at http://localhost:${PORT}`);
  console.log(`   YouTube API Key:   ${process.env.YOUTUBE_API_KEY ? "✅ set" : "⚠️  not set (provide via UI)"}`);
  console.log(`   Notion API Key:    ${process.env.NOTION_API_KEY ? "✅ set" : "⚠️  not set (provide via UI)"}`);
  console.log(`   Notion Database ID: ${process.env.NOTION_DATABASE_ID ? "✅ set" : "⚠️  not set (provide via UI)"}\n`);
});
