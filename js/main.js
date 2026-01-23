// ========= 設定 =========
const API_BASE = "https://wedding-like-api.karo2kai.workers.dev"; // あなたのWorker URL
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";

const THUMB_SIZE = 360;   // 一覧サムネ
const VIEW_W = 1600;      // タップ表示（高画質）の最大幅
const OPEN_W = 3000;      // 保存用の最大幅

const DISPLAY_STEP = 30;
const SCROLL_THRESHOLD_PX = 200;

// ========= DOM =========
const gallery = document.getElementById("gallery");
const fileInput = document.getElementById("fileInput");

const uploadOverlay = document.getElementById("uploadOverlay");
const uploadOverlaySub = document.getElementById("uploadOverlaySub");
const uploadOverlayProgress = document.getElementById("uploadOverlayProgress");
const uploadButtonLabel = document.querySelector(".upload-button");

const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewerImg");
const viewerOpen = document.getElementById("viewerOpen");
const viewerCopy = document.getElementById("viewerCopy");
const viewerClose = document.getElementById("viewerClose");
const viewerLoading = document.getElementById("viewerLoading");

// ========= State =========
let photos = []; // { id, thumb, view, open, likes }
let DISPLAY_LIMIT = 30;
let isLoadingMore = false;

let lastTopId = null;
const inflightLike = new Map();
const likesLoaded = new Set();

// ========= Cloudinary URL helpers =========
function cldThumb(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_${THUMB_SIZE},h_${THUMB_SIZE},q_auto,f_auto/${publicId}`;
}

// Safari安定のため JPG固定 + progressive + 上限
function cldView(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_${VIEW_W},q_auto:good,f_jpg,fl_progressive/${publicId}`;
}

// 保存用：重すぎ回避のため上限付き（それでも十分高画質）
function cldOpen(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_${OPEN_W},q_auto:best,f_jpg,fl_progressive/${publicId}`;
}

function listUrlByTag(tag) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(tag)}.json`;
}

function uploadEndpoint() {
  return `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
}

// ========= UI helpers =========
function showOverlay(sub, progressText) {
  if (!uploadOverlay) return;
  uploadOverlay.hidden = false;
  document.body.classList.add("no-scroll");

  if (uploadOverlaySub) uploadOverlaySub.textContent = sub || "しばらくお待ちください";
  if (uploadOverlayProgress) uploadOverlayProgress.textContent = progressText || "";

  uploadButtonLabel?.classList.add("is-disabled");
  if (fileInput) fileInput.disabled = true;
}

function hideOverlay() {
  if (!uploadOverlay) return;
  uploadOverlay.hidden = true;
  document.body.classList.remove("no-scroll");

  uploadButtonLabel?.classList.remove("is-disabled");
  if (fileInput) fileInput.disabled = false;
}

function showViewerLoading() {
  if (!viewerLoading) return;
  viewerLoading.hidden = false;
  viewerLoading.style.display = "grid";
}

function hideViewerLoading() {
  if (!viewerLoading) return;
  viewerLoading.hidden = true;
  viewerLoading.style.display = "none";
}

function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

// ========= Cloudinary list =========
async function fetchCloudinaryListByTag(tag) {
  const res = await fetch(listUrlByTag(tag), { cache: "no-store" });
  if (!res.ok) throw new Error(`Cloudinary list failed: ${res.status}`);
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
      open: cldOpen(String(publicId)),
      likes: 0,
    }));
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

// ========= Workers likes =========
async function fetchLikesBatch(ids) {
  const res = await fetch(`${API_BASE}/likes/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`batch failed: ${res.status}`);
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
    console.warn("batch likes error:", e);
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

// ========= Viewer (プリロード方式 / ぐるぐる確実停止) =========
function openViewer(photo) {
  if (!viewer || !viewerImg) return;

  viewer.hidden = false;
  document.body.classList.add("no-scroll");

  if (viewerOpen) viewerOpen.href = photo.open;

  // まずサムネを即表示
  viewerImg.src = photo.thumb;
  showViewerLoading();

  const highUrl = photo.view;

  // 世代管理：連打でも古いonloadが残らない
  const token = String(Date.now()) + Math.random().toString(16).slice(2);
  openViewer._token = token;

  const pre = new Image();
  const TIMEOUT_MS = 12000;

  const timer = setTimeout(() => {
    if (openViewer._token !== token) return;
    hideViewerLoading();
    console.warn("High-res timeout:", highUrl);
  }, TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timer);
    pre.onload = null;
    pre.onerror = null;
  };

  pre.onload = () => {
    if (openViewer._token !== token) return;
    cleanup();

    // 高画質に差し替え
    viewerImg.src = highUrl;

    // 読めてるのに残る対策：hidden + displayを両方
    hideViewerLoading();

    // 念のため次フレームでも消す（Safari保険）
    requestAnimationFrame(() => hideViewerLoading());
    setTimeout(() => hideViewerLoading(), 120);
  };

  pre.onerror = () => {
    if (openViewer._token !== token) return;
    cleanup();
    hideViewerLoading();
    console.warn("High-res load failed:", highUrl);
  };

  pre.decoding = "async";
  pre.loading = "eager";
  pre.src = highUrl;
}

function closeViewer() {
  if (!viewer) return;
  viewer.hidden = true;
  document.body.classList.remove("no-scroll");
  hideViewerLoading();
  if (viewerImg) viewerImg.src = "";
}

// ========= Render =========
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
      e.stopPropagation();
      if (inflightLike.get(photo.id)) return;

      // 即時反映（ローカルで順位が入れ替わる）
      photo.likes += 1;
      inflightLike.set(photo.id, true);
      render();

      try {
        // サーバにも反映（最終値はサーバを正とする）
        await likeOnServer(photo);
      } catch (err) {
        console.warn("like error:", err);
        // 失敗したらローカル増分を戻す（挙動がおかしい対策）
        photo.likes = Math.max(0, photo.likes - 1);
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

// ========= Infinite scroll =========
async function onScroll() {
  if (isLoadingMore) return;

  const nearBottom =
    window.innerHeight + window.scrollY >= document.body.offsetHeight - SCROLL_THRESHOLD_PX;

  if (!nearBottom) return;

  isLoadingMore = true;

  const prevLimit = DISPLAY_LIMIT;
  DISPLAY_LIMIT += DISPLAY_STEP;
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

// ========= Upload =========
async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("tags", TAG);

  const res = await fetch(uploadEndpoint(), { method: "POST", body: fd });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return await res.json();
}

async function refreshAfterUpload(uploadResults) {
  const immediate = uploadResults
    .map((r) => r?.public_id)
    .filter(Boolean)
    .map((publicId) => ({
      id: String(publicId),
      thumb: cldThumb(String(publicId)),
      view: cldView(String(publicId)),
      open: cldOpen(String(publicId)),
      likes: 0,
    }));

  photos = uniquePrepend(photos, immediate);
  await hydrateLikesFor(immediate);
  render();

  // list反映まで少しラグる場合があるので軽くリトライ
  for (let i = 0; i < 6; i++) {
    try {
      await new Promise((r) => setTimeout(r, 800));
      const data = await fetchCloudinaryListByTag(TAG);
      const next = normalizeFromListJson(data);
      photos = mergeKeepLikes(photos, next);
      render();
      return;
    } catch (_) {}
  }
}

// ========= Init =========
document.addEventListener("DOMContentLoaded", async () => {
  // Viewer close handlers（×が効かない問題をここで確実に潰す）
  viewerClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeViewer();
  });

  viewer?.addEventListener("click", (e) => {
    // 背景をタップしたら閉じる
    if (e.target && e.target.classList?.contains("viewer-backdrop")) {
      closeViewer();
    }
  });

  // URLコピー
  viewerCopy?.addEventListener("click", async () => {
    try {
      const url = viewerOpen?.href;
      if (!url) return;
      await navigator.clipboard.writeText(url);
      viewerCopy.textContent = "コピーしました";
      setTimeout(() => (viewerCopy.textContent = "URLコピー"), 1200);
    } catch {
      alert("コピーできませんでした（ブラウザ制限の可能性）。");
    }
  });

  // 無限スクロール
  window.addEventListener("scroll", () => { onScroll(); }, { passive: true });

  // 初期ロード
  showOverlay("写真を読み込んでいます", "");
  try {
    const data = await fetchCloudinaryListByTag(TAG);
    const next = normalizeFromListJson(data);
    photos = mergeKeepLikes(photos, next);

    render();

    // 最初に見えてる分のlikesだけ取得（高速化）
    const sorted = [...photos].sort((a, b) => b.likes - a.likes);
    await hydrateLikesFor(sorted.slice(0, DISPLAY_LIMIT));
    render();
  } catch (e) {
    console.warn("init error:", e);
    render();
  } finally {
    hideOverlay();
  }

  // アップロード
  fileInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    showOverlay("アップロード中…", `0 / ${files.length}`);

    try {
      const results = [];
      let done = 0;

      for (const f of files) {
        if (uploadOverlaySub) uploadOverlaySub.textContent = `アップロード中：${f.name}`;
        results.push(await uploadToCloudinary(f));
        done += 1;
        if (uploadOverlayProgress) uploadOverlayProgress.textContent = `${done} / ${files.length}`;
      }

      await refreshAfterUpload(results);
    } catch (err) {
      console.error(err);
      alert("アップロードに失敗しました。Cloudinary設定と通信を確認してください。");
    } finally {
      hideOverlay();
      fileInput.value = "";
    }
  });
});
