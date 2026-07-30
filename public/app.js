// ─── Y2N — YouTube to Notion ─── Client-side Logic (OAuth-first) ──────────── //

(function () {
  "use strict";

  // ── DOM Refs ────────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const notionStatus = $("#notionStatus");
  const disconnectBtn = $("#disconnectBtn");
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
  const selectedDbBar = $("#selectedDbBar");
  const selectedDbIcon = $("#selectedDbIcon");
  const selectedDbName = $("#selectedDbName");
  const changeDbBtn = $("#changeDbBtn");
  const dbModalOverlay = $("#dbModalOverlay");
  const dbModal = $("#dbModal");
  const dbList = $("#dbList");
  const dbModalCancel = $("#dbModalCancel");

  let serverConfig = { hasYoutubeKey: false, hasOAuth: false };

  // ── LocalStorage Keys ──────────────────────────────────────────────────────
  const LS_NOTION_TOKEN = "y2n_notion_token";
  const LS_DB_ID = "y2n_db_id";
  const LS_DB_NAME = "y2n_db_name";
  const LS_DB_ICON = "y2n_db_icon";
  const LS_PENDING_URL = "y2n_pending_playlist_url";

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getNotionToken() {
    return localStorage.getItem(LS_NOTION_TOKEN) || "";
  }

  function getSelectedDb() {
    const id = localStorage.getItem(LS_DB_ID);
    const name = localStorage.getItem(LS_DB_NAME);
    const icon = localStorage.getItem(LS_DB_ICON);
    return id ? { id, name, icon } : null;
  }

  function saveSelectedDb(db) {
    localStorage.setItem(LS_DB_ID, db.id);
    localStorage.setItem(LS_DB_NAME, db.title || db.name);
    localStorage.setItem(LS_DB_ICON, db.icon || "📄");
  }

  function clearNotionAuth() {
    localStorage.removeItem(LS_NOTION_TOKEN);
    localStorage.removeItem(LS_DB_ID);
    localStorage.removeItem(LS_DB_NAME);
    localStorage.removeItem(LS_DB_ICON);
    localStorage.removeItem(LS_PENDING_URL);
  }

  // ── UI State Updates ───────────────────────────────────────────────────────
  function updateConnectionUI() {
    const token = getNotionToken();
    const db = getSelectedDb();

    if (token) {
      notionStatus.style.display = "flex";
    } else {
      notionStatus.style.display = "none";
    }

    if (db) {
      selectedDbBar.style.display = "flex";
      selectedDbIcon.textContent = db.icon || "📄";
      selectedDbName.textContent = db.name;
    } else {
      selectedDbBar.style.display = "none";
    }
  }

  // ── Handle OAuth Callback ──────────────────────────────────────────────────
  function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get("oauth_success") === "true") {
      const token = urlParams.get("token");
      if (token) {
        localStorage.setItem(LS_NOTION_TOKEN, token);
        showToast("🎉 Connected to Notion!");
      }
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);

      // Check if there's a pending playlist URL to sync
      const pendingUrl = localStorage.getItem(LS_PENDING_URL);
      if (pendingUrl) {
        playlistUrlInput.value = pendingUrl;
        localStorage.removeItem(LS_PENDING_URL);
        // Auto-trigger sync after a short delay
        setTimeout(() => handleSync(), 500);
      }
    } else if (urlParams.get("oauth_error")) {
      showError(`Notion connection failed: ${urlParams.get("oauth_error")}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  // ── Load Server Config ─────────────────────────────────────────────────────
  async function loadServerConfig() {
    try {
      const res = await fetch("/api/config-status");
      if (res.ok) {
        serverConfig = await res.json();
      }
    } catch {
      // Offline fallback
    }
  }

  // ── Particles ──────────────────────────────────────────────────────────────
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

  // ── Step Card Glow ─────────────────────────────────────────────────────────
  function setupStepCards() {
    document.querySelectorAll(".step-card").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
        card.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
      });
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
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

  // ── Validation ─────────────────────────────────────────────────────────────
  function isValidPlaylistUrl(input) {
    if (!input) return false;
    const trimmed = input.trim();

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
      // non-URL
    }
    return false;
  }

  // ── Error / Progress / Loading ─────────────────────────────────────────────
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

  // ── Database Picker Modal ──────────────────────────────────────────────────
  function openDbModal() {
    dbModalOverlay.classList.add("open");
    dbModal.classList.add("open");
    fetchAndRenderDatabases();
  }

  function closeDbModal() {
    dbModalOverlay.classList.remove("open");
    dbModal.classList.remove("open");
  }

  async function fetchAndRenderDatabases() {
    const token = getNotionToken();
    dbList.innerHTML = `
      <div class="db-loading">
        <svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>
        <span>Loading your databases...</span>
      </div>
    `;

    try {
      const res = await fetch("/api/list-databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notionToken: token }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load databases");
      }

      if (!data.databases || data.databases.length === 0) {
        dbList.innerHTML = `
          <div class="db-empty">
            <p>😕 No databases found.</p>
            <p class="db-empty-hint">Make sure you selected at least one database when connecting to Notion. Try disconnecting and reconnecting.</p>
          </div>
        `;
        return;
      }

      dbList.innerHTML = "";
      data.databases.forEach((db) => {
        const item = document.createElement("button");
        item.classList.add("db-item");
        item.innerHTML = `
          <span class="db-item-icon">${db.icon}</span>
          <span class="db-item-title">${db.title}</span>
        `;
        item.addEventListener("click", () => {
          saveSelectedDb(db);
          updateConnectionUI();
          closeDbModal();
          showToast(`📁 Selected: ${db.title}`);

          // If we were in the middle of a sync, continue it
          const pendingUrl = playlistUrlInput.value.trim();
          if (pendingUrl && isValidPlaylistUrl(pendingUrl)) {
            setTimeout(() => performSync(pendingUrl), 300);
          }
        });
        dbList.appendChild(item);
      });
    } catch (err) {
      dbList.innerHTML = `
        <div class="db-empty">
          <p>❌ ${err.message}</p>
          <p class="db-empty-hint">Your Notion connection may have expired. Try disconnecting and reconnecting.</p>
        </div>
      `;
    }
  }

  // ── Main Sync Handler ─────────────────────────────────────────────────────
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

    // Step 1: Check if connected to Notion
    const token = getNotionToken();
    if (!token) {
      // Save the playlist URL and redirect to OAuth
      localStorage.setItem(LS_PENDING_URL, playlistUrl);
      window.location.href = "/auth/notion";
      return;
    }

    // Step 2: Check if database is selected
    const db = getSelectedDb();
    if (!db) {
      // Show database picker
      openDbModal();
      return;
    }

    // Step 3: Perform the sync
    await performSync(playlistUrl);
  }

  async function performSync(playlistUrl) {
    const token = getNotionToken();
    const db = getSelectedDb();

    if (!token || !db) return;

    setLoading(true);
    showProgress("🎬 Connecting to YouTube...", 5);

    try {
      const response = await fetch("/api/sync-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistUrl,
          notionApiKey: token,
          notionDatabaseId: db.id,
        }),
      });

      let fakeProgress = 10;
      const progressInterval = setInterval(() => {
        fakeProgress = Math.min(fakeProgress + Math.random() * 8, 90);
        showProgress("📡 Fetching videos & adding to Notion...", fakeProgress);
      }, 1200);

      const data = await response.json();
      clearInterval(progressInterval);

      if (!response.ok) {
        // If token expired or unauthorized, clear auth and show error
        if (response.status === 401 || response.status === 403) {
          clearNotionAuth();
          updateConnectionUI();
          throw new Error("Notion connection expired. Please click 'Sync to Notion' to reconnect.");
        }
        throw new Error(data.error || "Sync failed");
      }

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

  // ── Event Listeners ────────────────────────────────────────────────────────
  syncBtn.addEventListener("click", handleSync);
  playlistUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSync();
  });
  syncAnotherBtn.addEventListener("click", resetToInput);

  // Database modal
  dbModalOverlay.addEventListener("click", (e) => {
    if (e.target === dbModalOverlay) closeDbModal();
  });
  dbModalCancel.addEventListener("click", closeDbModal);
  changeDbBtn.addEventListener("click", openDbModal);

  // Disconnect
  disconnectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearNotionAuth();
    updateConnectionUI();
    showToast("🔌 Disconnected from Notion");
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDbModal();
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    createParticles();
    setupStepCards();
    await loadServerConfig();
    handleOAuthCallback();
    updateConnectionUI();
    playlistUrlInput.focus();
  }

  init();
})();
