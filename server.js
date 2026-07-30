require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Client } = require("@notionhq/client");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Utility Helpers ──────────────────────────────────────────────────────────

function extractPlaylistId(input) {
  if (!input) return null;
  const trimmed = input.trim();

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

function extractDatabaseId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  const hexMatch = trimmed.match(/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/i);
  if (hexMatch) {
    return hexMatch[1].replace(/-/g, "");
  }

  return null;
}

// ─── YouTube Service ──────────────────────────────────────────────────────────

async function fetchPlaylistVideos(playlistId, apiKey) {
  const BASE_URL = "https://www.googleapis.com/youtube/v3";
  let allItems = [];
  let nextPageToken = null;
  let playlistTitle = "YouTube Playlist";

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
      url: `youtu.be/${item.contentDetails.videoId}`,
    }));

  return { playlistTitle, videos, totalCount: videos.length };
}

// ─── Notion Service ───────────────────────────────────────────────────────────

/**
 * Get the next available number in the database if a number property exists.
 */
async function getNextNumber(notion, databaseId, numberPropKey) {
  if (!numberPropKey) return 1;
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      sorts: [{ property: numberPropKey, direction: "descending" }],
      page_size: 1,
    });

    if (response.results.length > 0) {
      const topPage = response.results[0];
      const numProp = topPage.properties[numberPropKey];
      if (numProp && numProp.number !== null) {
        return numProp.number + 1;
      }
    }
  } catch {
    // Default to 1
  }
  return 1;
}

/**
 * Add a playlist as a page in the user's existing database.
 * Dynamically detects existing schema properties (Title, Number, Status/Select)
 * to prevent crashes if a column doesn't exist.
 */
async function addPlaylistToDatabase(
  notionApiKey,
  databaseId,
  playlistTitle,
  videos,
  onProgress
) {
  const notion = new Client({ auth: notionApiKey });

  // 1. Fetch database schema to inspect actual column names & types
  onProgress?.({ step: "checking", message: "Inspecting database schema..." });
  const dbSchema = await notion.databases.retrieve({ database_id: databaseId });
  const props = dbSchema.properties || {};

  // Find the Title property (every Notion DB has exactly 1 title property)
  let titlePropKey = Object.keys(props).find(
    (key) => props[key].type === "title"
  );
  if (!titlePropKey) titlePropKey = "Name"; // Fallback

  // Find Number property if it exists
  const numberPropKey = Object.keys(props).find(
    (key) => props[key].type === "number" || key.toLowerCase() === "number" || key === "#"
  );

  // Find Status or Select property if it exists
  const statusPropKey = Object.keys(props).find(
    (key) =>
      props[key].type === "status" ||
      props[key].type === "select" ||
      key.toLowerCase() === "status"
  );

  // Determine next number
  const nextNum = await getNextNumber(notion, databaseId, numberPropKey);

  // 2. Build to-do blocks with nested native video player blocks
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
          text: { content: video.channel },
          annotations: { bold: true },
        },
        {
          type: "text",
          text: { content: " — " },
        },
        {
          type: "text",
          text: {
            content: video.title,
            link: { url: video.url },
          },
          annotations: { color: "blue" },
        },
      ],
      checked: false,
      children: [
        {
          object: "block",
          type: "video",
          video: {
            type: "external",
            external: {
              url: `https://www.youtube.com/watch?v=${video.videoId}`,
            },
          },
        },
      ],
    },
  }));

  // 3. Construct page properties safely according to existing DB schema
  const pageProperties = {};
  
  // Set title
  pageProperties[titlePropKey] = {
    title: [{ text: { content: playlistTitle } }],
  };

  // Set number if property exists
  if (numberPropKey && props[numberPropKey]?.type === "number") {
    pageProperties[numberPropKey] = { number: nextNum };
  }

  // Set status/select if property exists
  if (statusPropKey) {
    const propType = props[statusPropKey].type;
    if (propType === "status") {
      // Find "Not started" or default to first available status option
      const options = props[statusPropKey].status?.options || [];
      const notStartedOpt = options.find(
        (o) => o.name.toLowerCase() === "not started"
      ) || options[0];

      if (notStartedOpt) {
        pageProperties[statusPropKey] = { status: { name: notStartedOpt.name } };
      }
    } else if (propType === "select") {
      const options = props[statusPropKey].select?.options || [];
      const notStartedOpt = options.find(
        (o) => o.name.toLowerCase() === "not started"
      ) || options[0];

      if (notStartedOpt) {
        pageProperties[statusPropKey] = { select: { name: notStartedOpt.name } };
      }
    }
  }

  // 4. Create the page
  onProgress?.({
    step: "creating_page",
    message: `Creating page "${playlistTitle}"...`,
  });

  // Each to-do has 1 nested video block → 2 blocks per video → batch size = 50
  const BATCH_SIZE = 50;

  const firstBatch = todoBlocks.slice(0, BATCH_SIZE);
  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    icon: { type: "emoji", emoji: "📺" },
    properties: pageProperties,
    children: firstBatch,
  });

  // 5. Append remaining blocks in batches
  if (todoBlocks.length > BATCH_SIZE) {
    for (let i = BATCH_SIZE; i < todoBlocks.length; i += BATCH_SIZE) {
      const batch = todoBlocks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      onProgress?.({
        step: "appending",
        message: `Adding videos batch ${batchNum}... (${Math.min(i + BATCH_SIZE, todoBlocks.length)}/${todoBlocks.length})`,
        progress: Math.round((i / todoBlocks.length) * 100),
      });

      await notion.blocks.children.append({
        block_id: page.id,
        children: batch,
      });

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

app.get("/api/config-status", (req, res) => {
  res.json({
    hasYoutubeKey: !!process.env.YOUTUBE_API_KEY,
    hasOAuth: !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET),
  });
});

app.get("/auth/notion", (req, res) => {
  const clientId = process.env.NOTION_CLIENT_ID;
  const redirectUri =
    process.env.OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/auth/notion/callback`;

  if (!clientId) {
    return res.status(400).send("Notion OAuth Client ID is not configured on the server.");
  }

  const oauthUrl = `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code`;

  res.redirect(oauthUrl);
});

app.get("/auth/notion/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`/?oauth_error=${encodeURIComponent(error || "Access denied")}`);
  }

  try {
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri =
      process.env.OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/auth/notion/callback`;

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokenData.error || "Failed to exchange authorization code");
    }

    const accessToken = tokenData.access_token;
    const databaseId = tokenData.duplicated_template_id || "";

    res.redirect(
      `/?oauth_success=true&token=${encodeURIComponent(accessToken)}&db_id=${encodeURIComponent(databaseId)}`
    );
  } catch (err) {
    console.error("OAuth Exchange Error:", err.message);
    res.redirect(`/?oauth_error=${encodeURIComponent(err.message)}`);
  }
});

// ─── List Databases (for database picker) ─────────────────────────────────────

app.post("/api/list-databases", async (req, res) => {
  try {
    const { notionToken } = req.body;
    if (!notionToken) {
      return res.status(400).json({ error: "Notion token is required" });
    }

    const notion = new Client({ auth: notionToken });
    const response = await notion.search({
      filter: { property: "object", value: "database" },
      page_size: 50,
    });

    const databases = response.results.map((db) => {
      // Extract the title from the database
      const titleParts = db.title || [];
      const title = titleParts.map((t) => t.plain_text).join("") || "Untitled";
      return {
        id: db.id,
        title,
        icon: db.icon?.emoji || "📄",
        url: db.url,
      };
    });

    res.json({ databases });
  } catch (err) {
    console.error("❌ List databases error:", err.message);
    res.status(500).json({ error: err.message || "Failed to list databases" });
  }
});

// ─── Sync Playlist ────────────────────────────────────────────────────────────

app.post("/api/sync-playlist", async (req, res) => {
  try {
    const { playlistUrl, notionApiKey, notionDatabaseId } = req.body;

    const youtubeApiKey = process.env.YOUTUBE_API_KEY;

    if (!playlistUrl) {
      return res.status(400).json({ error: "Playlist URL is required" });
    }
    if (!youtubeApiKey) {
      return res.status(400).json({ error: "YouTube API key is not configured on the server" });
    }
    if (!notionApiKey) {
      return res.status(400).json({ error: "Notion token is required. Please connect to Notion first." });
    }
    if (!notionDatabaseId) {
      return res.status(400).json({ error: "Please select a Notion database to sync into." });
    }

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
      return res.status(400).json({ error: "Could not extract playlist ID from the URL" });
    }

    console.log(`\n🎬 Syncing playlist: ${playlistId} into Notion DB: ${notionDatabaseId}`);

    const { playlistTitle, videos, totalCount } = await fetchPlaylistVideos(
      playlistId,
      youtubeApiKey
    );

    if (totalCount === 0) {
      return res.status(404).json({
        error: "No videos found in this playlist. It may be private or empty.",
      });
    }

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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Y2N server running at http://localhost:${PORT}`);
  console.log(`   YouTube API Key:    ${process.env.YOUTUBE_API_KEY ? "✅ set" : "⚠️  not set"}`);
  console.log(`   Notion OAuth:       ${process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET ? "✅ configured" : "⚠️  not set"}\n`);
});
