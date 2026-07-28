// ─── Y2N — YouTube to Notion ─── Client-side Logic ────────────────────────── //

(function () {
  "use strict";

  // ── DOM Refs ────────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const settingsToggle = $("#settingsToggle");
  const settingsOverlay = $("#settingsOverlay");
  const settingsPanel = $("#settingsPanel");
  const settingsClose = $("#settingsClose");
  const saveSettingsBtn = $("#saveSettings");
  const youtubeKeyInput = $("#youtubeKey");
  const notionKeyInput = $("#notionKey");
  const notionDatabaseIdInput = $("#notionDatabaseId");
  const playlistUrlInput = $("#playlistUrl");
  const syncBtn = $("#syncBtn");
  const progressSection = $("#progressSection");
  const progressFill = $("#progressFill");
  const progressStatus = $("#progressStatus");
  const errorCard = $("#errorCard");
  const errorMessage = $("#errorMessage");
  const resultSection = $("#resultSection");
  const resultInfo = $("#resultInfo");
  const notionLink = $("#notionLink");
  const syncAnotherBtn = $("#syncAnotherBtn");
  const hero = $("#hero");

  // ── Server-side config status ──────────────────────────────────────────────
  let serverConfig = {
    hasYoutubeKey: false,
    hasNotionKey: false,
    hasNotionDatabaseId: false,
    allConfigured: false,
  };

  // Check what's already configured in .env on the server
  async function loadServerConfig() {
    try {
      const res = await fetch("/api/config-status");
      if (res.ok) {
        serverConfig = await res.json();

        // If all keys are in .env, hide the settings button entirely
        if (serverConfig.allConfigured) {
          settingsToggle.style.display = "none";
        }
      }
    } catch {
      // Server not reachable, user will need to configure manually
    }
  }
  loadServerConfig();

  // ── Particles Background ───────────────────────────────────────────────────
  function createParticles() {
    const container = $("#bgParticles");
    const colors = [
      "rgba(255, 0, 51, 0.3)",
      "rgba(139, 92, 246, 0.25)",
      "rgba(6, 182, 212, 0.2)",
      "rgba(255, 107, 53, 0.2)",
    ];

    for (let i = 0; i < 30; i++) {
      const p = document.createElement("div");
      p.classList.add("particle");
      const size = Math.random() * 4 + 2;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = `${Math.random() * 15 + 10}s`;
      p.style.animationDelay = `${Math.random() * 10}s`;
      container.appendChild(p);
    }
  }
  createParticles();

  // ── Interactive glow on step cards ─────────────────────────────────────────
  document.querySelectorAll(".step-card").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
      card.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    });
  });

  // ── Settings Panel ─────────────────────────────────────────────────────────
  function openSettings() {
    settingsOverlay.classList.add("open");
    settingsPanel.classList.add("open");
  }

  function closeSettings() {
    settingsOverlay.classList.remove("open");
    settingsPanel.classList.remove("open");
  }

  settingsToggle.addEventListener("click", openSettings);
  settingsOverlay.addEventListener("click", closeSettings);
  settingsClose.addEventListener("click", closeSettings);

  // Load saved keys from localStorage
  function loadSettings() {
    youtubeKeyInput.value = localStorage.getItem("y2n_youtube_key") || "";
    notionKeyInput.value = localStorage.getItem("y2n_notion_key") || "";
    notionDatabaseIdInput.value = localStorage.getItem("y2n_notion_database_id") || "";
  }
  loadSettings();

  saveSettingsBtn.addEventListener("click", () => {
    localStorage.setItem("y2n_youtube_key", youtubeKeyInput.value.trim());
    localStorage.setItem("y2n_notion_key", notionKeyInput.value.trim());
    localStorage.setItem("y2n_notion_database_id", notionDatabaseIdInput.value.trim());
    closeSettings();
    showToast("✅ Settings saved!");
  });

  // ── Toast Notification ─────────────────────────────────────────────────────
  function showToast(message) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.classList.add("toast");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2800);
  }

  // ── Playlist URL Validation ────────────────────────────────────────────────
  function isValidPlaylistUrl(input) {
    if (!input) return false;
    const trimmed = input.trim();

    // Raw playlist ID
    if (/^PL[A-Za-z0-9_-]+$/.test(trimmed)) return true;

    try {
      const url = new URL(trimmed);
      if (
        url.hostname.includes("youtube.com") ||
        url.hostname.includes("youtu.be")
      ) {
        return !!url.searchParams.get("list");
      }
    } catch {
      // not a valid URL
    }
    return false;
  }

  // ── UI State Helpers ───────────────────────────────────────────────────────
  function showError(msg) {
    errorMessage.textContent = msg;
    errorCard.classList.add("visible");
    progressSection.classList.remove("visible");
  }

  function hideError() {
    errorCard.classList.remove("visible");
  }

  function showProgress(message, percent) {
    progressSection.classList.add("visible");
    progressStatus.textContent = message;
    progressFill.style.width = `${percent}%`;
  }

  function hideProgress() {
    progressSection.classList.remove("visible");
    progressFill.style.width = "0%";
  }

  function setLoading(loading) {
    syncBtn.classList.toggle("loading", loading);
    syncBtn.disabled = loading;
    playlistUrlInput.disabled = loading;
  }

  function showResult(data) {
    hero.style.display = "none";
    resultSection.classList.add("visible");
    resultInfo.innerHTML = `
      <strong>"${data.playlistTitle}"</strong> added as entry #${data.number}<br/>
      ${data.totalCreated} videos synced as trackable to-dos inside the page.
    `;
    notionLink.href = data.notionPageUrl;
  }

  function resetToInput() {
    hero.style.display = "";
    resultSection.classList.remove("visible");
    hideError();
    hideProgress();
    setLoading(false);
    playlistUrlInput.value = "";
    playlistUrlInput.focus();
  }

  // ── Check if keys are available (either from server .env or localStorage) ──
  function hasRequiredKeys() {
    const hasYt = serverConfig.hasYoutubeKey || !!localStorage.getItem("y2n_youtube_key");
    const hasNotion = serverConfig.hasNotionKey || !!localStorage.getItem("y2n_notion_key");
    const hasDb = serverConfig.hasNotionDatabaseId || !!localStorage.getItem("y2n_notion_database_id");
    return hasYt && hasNotion && hasDb;
  }

  // ── Sync Handler ───────────────────────────────────────────────────────────
  syncBtn.addEventListener("click", handleSync);
  playlistUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSync();
  });
  syncAnotherBtn.addEventListener("click", resetToInput);

  async function handleSync() {
    hideError();

    const playlistUrl = playlistUrlInput.value.trim();
    if (!playlistUrl) {
      showError("Please paste a YouTube playlist URL.");
      return;
    }

    if (!isValidPlaylistUrl(playlistUrl)) {
      showError(
        'This doesn\'t look like a valid YouTube playlist URL. Make sure it contains "list=" parameter.'
      );
      return;
    }

    // Check for API keys — server .env keys take priority
    if (!hasRequiredKeys()) {
      showError(
        "Missing API keys! Click the ⚙️ Settings button in the top-right to add your YouTube API key, Notion token, and Database ID."
      );
      setTimeout(openSettings, 800);
      return;
    }

    // Start sync
    setLoading(true);
    showProgress("🎬 Connecting to YouTube...", 5);

    try {
      // Only send keys from localStorage if server doesn't have them in .env
      const body = { playlistUrl };
      if (!serverConfig.hasYoutubeKey) {
        body.youtubeApiKey = localStorage.getItem("y2n_youtube_key") || "";
      }
      if (!serverConfig.hasNotionKey) {
        body.notionApiKey = localStorage.getItem("y2n_notion_key") || "";
      }
      if (!serverConfig.hasNotionDatabaseId) {
        body.notionDatabaseId = localStorage.getItem("y2n_notion_database_id") || "";
      }

      const response = await fetch("/api/sync-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Simulate progress during the request
      let fakeProgress = 10;
      const progressInterval = setInterval(() => {
        fakeProgress = Math.min(fakeProgress + Math.random() * 8, 90);
        showProgress("📡 Fetching videos & adding to Notion...", fakeProgress);
      }, 1200);

      const data = await response.json();
      clearInterval(progressInterval);

      if (!response.ok) {
        throw new Error(data.error || "Sync failed");
      }

      // Show completion
      showProgress("✅ Playlist added to your database!", 100);
      await new Promise((resolve) => setTimeout(resolve, 800));
      hideProgress();
      setLoading(false);
      showResult(data);
    } catch (err) {
      setLoading(false);
      hideProgress();
      showError(err.message || "Something went wrong. Please try again.");
    }
  }

  // ── Keyboard shortcut: Escape closes settings ─────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  // ── Auto-focus playlist input ──────────────────────────────────────────────
  playlistUrlInput.focus();
})();
