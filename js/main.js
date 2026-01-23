const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// Cloudinary
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";

// 一覧は軽く：サムネ
const THUMB_SIZE = 360;

// タップで開く高画質：この上限なら十分キレイ＆重すぎない
const VIEW_MAX_W = 2400;

const gallery = document.getElementById("gallery");
const fileInput = document.getElementById("fileInput");

// Upload overlay DOM
const uploadOverlay = document.getElementById("uploadOverlay");
const uploadOverlaySub = document.getElementById("uploadOverlaySub");
const uploadOverlayProgress = document.getElementById("uploadOverlayProgress");
const uploadButtonLabel = document.querySelector(".upload-button");

// Viewer DOM
const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewerImg");
const viewerOpen = document.getElementById("viewerOpen");
const viewerCopy = document.getElementById("viewerCopy");
const viewerClose = document.getElementById("viewerClose");
const viewerLoading = document.getElementById("viewerLoading");

// Infinite scroll
let DISPLAY_LIMIT = 30;
const STEP = 30;
const SCROLL_THRESHOLD_PX = 200;

// State
let photos = []; // { id, thumb, view, open, likes }
let lastTopId = null;
const inflightLike = new Map();
let isLoadingMore = false;

// likes取得済み
const likesLoaded = new Set();

console.log("main.js loaded ✅", new Date().toISOString());

// ---------- Overlay helpers ----------
function showOverlay(sub, progressText) {
  if (!uploadOverlay) return;
  uploadOverlay.hidden = false;
  uploadOverlay.style.pointerEvents = "auto";
  document.body.classList.add("no-scroll");

  if (uploadOverlaySub) uploadOverlaySub.textContent = sub || "しばらくお待ちください";
  if (uploadOverlayProgress) uploadOverlayProgress.textContent = progressText || "";

  uploadButtonLabel?.classList.add("is-disabled");
  if (fileInput) fileInput.disabled = true;
}

function hideOverlay() {
  if (!uploadOverlay) return;
  uploadOverlay.hidden = true;
  uploadOverlay.style.pointerEvents = "none";
  document.body.classList.remove("no-scroll");

  uploadButtonLabel?.classList.remove("is-disabled");
  if (fileInput) fileInput.disabled = false;
}

function showUploading(totalFiles) {
  showOverlay("しばらくお待ちください", totalFiles ? `0 / ${totalFiles}` : "");
}

function updateUploading(done, total, fileName) {
  if (uploadOverlayProgress) uploadOverlayProgress.textContent = `${done} / ${total}`;
  if (uploadOverlaySub) uploadOverlaySub.textContent = fileName ? `アップロード中：${fileName}` : "しばらくお待ちください";
}

function showLoadingInitial() {
  showOverlay("写真を読み込んでいます", "");
}

// ---------- Viewer helpers ----------
function openViewer(photo) {
  if (!viewer || !viewerImg) return;

  viewer.hidden = false;
  document.body.classList.add("no-scroll");

  // 保存導線
  if (viewerOpen) viewerOpen.href = photo.open;

  // まず軽いサムネを即表示（体感改善）
  viewerImg.src = photo.thumb;

  // ローディング表示
  if (viewerLoading) viewerLoading.hidden = false;

  const high = photo.view;

  // 高画質は別Imageでプリロード（これが重要）
  const pre = new Image();

  const cleanup = () => {
    pre.onload = null;
    pre.onerror = null;
  };

  const fail = () => {
    cleanup();
    if (viewerLoading) viewerLoading.hidden = true;

    // iPhoneだと alert が出ない/遅延することがあるので、まずはボタンで逃がす
    console.warn("High-res load failed:", high);
    // ここは任意：失敗しても viewer は開いたまま（サムネは見えている）
    // 必要ならメッセージ要素を出す実装もできます
  };

  pre.onload = () => {
    cleanup();
    // 読み込みが終わったら差し替え
    viewerImg.src = high;
    if (viewerLoading) viewerLoading.hidden = true;
  };

  pre.onerror = fail;

  // タイムアウト（無限ぐるぐる防止）
  const timer = setTimeout(() => {
    // まだ読み込みが終わっていないなら中断扱い
    cleanup();
    if (viewerLoading) viewerLoading.hidden = true;
    console.warn("High-res load timeout:", high);
  }, 12000);

  // onload / onerror のどちらでも timer を止める
  const stopTimer = () => clearTimeout(timer);
  pre.addEventListener("load", stopTimer, { once: true });
  pre.addEventListener("error", stopTimer, { once: true });

  pre.decoding = "async";
  pre.loading = "eager";
  pre.src = high;
}

function closeViewer() {
  if (!viewer) return;
  viewer.hidden = true;
  document.body.classList.remove("no-scroll");
  if (viewerImg) viewerImg.src = "";
}

viewerClose?.addEventListener("click", closeViewer);
viewer?.addEventListener("click", (e) => {
  // 背景をタップしたら閉じる（シート内は閉じない）
  if (e.target && (e.target.classList?.contains("viewer-backdrop"))) closeViewer();
});

viewerCopy?.addEventListener("click", async () => {
  try {
    const url = viewerOpen?.href;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    viewerCopy.textContent = "コピーしました";
    setTimeout(() => (viewerCopy.textContent = "URLコピー"), 1200);
  } catch {
    alert("コピーできませんでした（iPhoneの設定/ブラウザによって制限があります）。");
  }
});

// ---------- Helpers ----------
function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

// 一覧：スクエア切り抜きサムネ（軽い）
function cldThumb(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_${THUMB_SIZE},h_${THUMB_SIZE},dpr_auto,q_auto,f_auto/${publicId}`;
}

// タップ表示：高画質（比率維持、上限だけ付ける）
function cldView(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_1600,q_auto:good,f_auto/${publicId}`;
}

// 原寸で開く（保存導線）：変換なし（オリジナル）
function cldOpenOriginal(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${publicId}`;
}

function listUrlByTag(tag) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(tag)}.json`;
}

function uploadEndpoint() {
  return `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeKeepLikes(current, next) {
  const likeMap = new Map(current.map((p) => [p.id, p.likes]));
  return next.map((p) => ({ ...p, likes: likeMap.get(p.id) ?? p.likes ?? 0 }));
}

function uniquePrepend(current, toAdd) {
  const existing = new Set(current.map((p) => p.id));
  const fresh = toAdd.filter((p) => !existing.has(p.id));
  return fresh.length ? [...fresh, ...current] : current;
}

// ---------- Cloudinary ----------
async function fetchCloudinaryListByTag(tag) {
  const res = await fetch(listUrlByTag(tag), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudinary list failed: ${res.status} ${text}`);
  }
  return await res.json();
}

function normalizeFromListJson(data) {
  const resources = Array.isArray(data.resources) ? data.resources : [];
  return resources
    .map((r) => r.public_id)
    .filter(Boolean)
    .map((publicId) => ({
      id: String(publicId),
      thumb: cldThumb(String(publicId)),
      view: cldView(String(publicId)),
      open: cldOpenOriginal(String(publicId)),
      likes: 0,
    }));
}

async function loadGalleryFromCloudinary() {
  try {
    const data = await fetchCloudinaryListByTag(TAG);
    const next = normalizeFromListJson(data);
    photos = mergeKeepLikes(photos, next);
  } catch (err) {
    console.warn("list error ⚠️", err?.message || err);
    photos = photos || [];
  }
}

async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("tags", TAG);

  const res = await fetch(uploadEndpoint(), { method: "POST", body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed: ${res.status} ${text}`);
  }
  return await res.json();
}

// ---------- Workers likes (BATCH) ----------
async function fetchLikesBatch(ids) {
  const res = await fetch(`${API_BASE}/likes/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`batch failed: ${res.status} ${t}`);
  }
  return await res.json();
}

async function hydrateLikesFor(list) {
  const targets = list.filter((p) => p && !likesLoaded.has(p.id));
  if (targets.length === 0) return;

  const ids = targets.map((p) => p.id);
  try {
    const data = await fetchLikesBatch(ids);
    const likeMap = data?.likes || {};

    for (const p of targets) {
      p.likes = Number(likeMap[p.id]) || 0;
      likesLoaded.add(p.id);
    }
  } catch (e) {
    console.warn("batch likes error ⚠️", e?.message || e);
  }
}

async function likeOnServer(photo) {
  const res = await fetch(`${API_BASE}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: photo.id }),
  });
  const data = await res.json();
  photo.likes = Number(data.likes) || photo.likes;
  likesLoaded.add(photo.id);
}

// ---------- Render ----------
function render() {
  gallery.innerHTML = "";

  if (!photos || photos.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "16px";
    empty.style.color = "#666";
    empty.style.textAlign = "center";
    empty.textContent = "まだ写真がありません。上のボタンからアップロードしてね。";
    gallery.appendChild(empty);
    return;
  }

  const sorted = [...photos].sort((a, b) => b.likes - a.likes);
  const visible = sorted.slice(0, DISPLAY_LIMIT);
  const currentTopId = visible[0]?.id;

  visible.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    if (index === 0) {
      card.classList.add("rank-1");
      if (lastTopId && lastTopId !== photo.id) card.classList.add("pop");
    }

    const img = document.createElement("img");
    img.src = photo.thumb;
    img.alt = photo.id;
    img.loading = "lazy";
    img.decoding = "async";

    // タップで高画質ビューア
    img.addEventListener("click", () => openViewer(photo));

    const likeBtn = document.createElement("button");
    likeBtn.className = "like";

    const busy = inflightLike.get(photo.id) === true;
    likeBtn.textContent = `${getCrown(index)} ❤️ ${photo.likes}${busy ? "…" : ""}`;
    likeBtn.disabled = busy;
    likeBtn.style.opacity = busy ? "0.6" : "1";

    likeBtn.addEventListener("click", async (e) => {
      // ここ重要：likeボタン押下で viewer が開かないように
      e.stopPropagation();

      if (inflightLike.get(photo.id)) return;
      inflightLike.set(photo.id, true);
      render();

      try {
        await likeOnServer(photo);
      } catch (err) {
        console.warn("like error ⚠️", err);
      } finally {
        inflightLike.set(photo.id, false);
        render();
      }
    });

    card.appendChild(img);
    card.appendChild(likeBtn);
    gallery.appendChild(card);
  });

  lastTopId = currentTopId;

  if (sorted.length > DISPLAY_LIMIT) {
    const hint = document.createElement("div");
    hint.style.padding = "14px";
    hint.style.color = "#666";
    hint.style.textAlign = "center";
    hint.textContent = isLoadingMore ? "読み込み中…" : "下にスクロールで続きを表示";
    gallery.appendChild(hint);
  }
}

// ---------- Infinite scroll ----------
async function onScroll() {
  if (isLoadingMore) return;

  const nearBottom =
    window.innerHeight + window.scrollY >= document.body.offsetHeight - SCROLL_THRESHOLD_PX;

  if (!nearBottom) return;

  isLoadingMore = true;

  const prevLimit = DISPLAY_LIMIT;
  DISPLAY_LIMIT += STEP;

  render();

  const sorted = [...photos].sort((a, b) => b.likes - a.likes);
  const newlyVisible = sorted.slice(prevLimit, DISPLAY_LIMIT);
  await hydrateLikesFor(newlyVisible);

  render();

  setTimeout(() => {
    isLoadingMore = false;
    render();
  }, 150);
}

window.addEventListener("scroll", () => { onScroll(); }, { passive: true });

// ---------- Post-upload refresh ----------
async function refreshAfterUpload(uploadResults) {
  const immediate = uploadResults
    .map((r) => r?.public_id)
    .filter(Boolean)
    .map((publicId) => ({
      id: String(publicId),
      thumb: cldThumb(String(publicId)),
      view: cldView(String(publicId)),
      open: cldOpenOriginal(String(publicId)),
      likes: 0,
    }));

  photos = uniquePrepend(photos, immediate);

  await hydrateLikesFor(immediate);

  DISPLAY_LIMIT = Math.max(DISPLAY_LIMIT, 30);
  render();

  for (let i = 0; i < 6; i++) {
    try {
      await sleep(800);
      const data = await fetchCloudinaryListByTag(TAG);
      const next = normalizeFromListJson(data);
      photos = mergeKeepLikes(photos, next);
      render();

      const ids = new Set(photos.map((p) => p.id));
      const allPresent = immediate.every((p) => ids.has(p.id));
      if (allPresent) return;
    } catch {
      // ignore
    }
  }
}

// ---------- Upload UI ----------
fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  showUploading(files.length);

  try {
    const results = [];
    let done = 0;

    for (const f of files) {
      updateUploading(done, files.length, f.name);
      results.push(await uploadToCloudinary(f));
      done += 1;
      updateUploading(done, files.length, f.name);
    }

    await refreshAfterUpload(results);
  } catch (err) {
    console.error(err);
    alert("アップロードに失敗しました。設定（CLOUD_NAME / UPLOAD_PRESET）と通信を確認してください。");
  } finally {
    hideOverlay();
    fileInput.value = "";
  }
});

// ---------- Init ----------
(async () => {
  showLoadingInitial();
  try {
    await loadGalleryFromCloudinary();
    render();

    const sorted = [...photos].sort((a, b) => b.likes - a.likes);
    const firstVisible = sorted.slice(0, DISPLAY_LIMIT);
    await hydrateLikesFor(firstVisible);

    render();
  } catch (e) {
    console.warn("init error ⚠️", e);
    render();
  } finally {
    hideOverlay();
  }
})();
