const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// Cloudinary
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";
const THUMB_SIZE = 360;

const gallery = document.getElementById("gallery");
const fileInput = document.getElementById("fileInput");

// Overlay DOM
const uploadOverlay = document.getElementById("uploadOverlay");
const uploadOverlaySub = document.getElementById("uploadOverlaySub");
const uploadOverlayProgress = document.getElementById("uploadOverlayProgress");
const uploadButtonLabel = document.querySelector(".upload-button");

// Infinite scroll
let DISPLAY_LIMIT = 30;
const STEP = 30;
const SCROLL_THRESHOLD_PX = 200;

// State
let photos = []; // { id, src, likes }
let lastTopId = null;
const inflightLike = new Map();
let isLoadingMore = false;

// likes取得済み管理
const likesLoaded = new Set();

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

// ---------- Helpers ----------
function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

function cldThumb(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_${THUMB_SIZE},h_${THUMB_SIZE},dpr_auto,q_auto,f_auto/${publicId}`;
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
      src: cldThumb(String(publicId)),
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
  return await res.json(); // { likes: {id: number} }
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
    img.src = photo.src;
    img.alt = photo.id;
    img.loading = "lazy";
    img.decoding = "async";

    const likeBtn = document.createElement("button");
    likeBtn.className = "like";

    const busy = inflightLike.get(photo.id) === true;
    likeBtn.textContent = `${getCrown(index)} ❤️ ${photo.likes}${busy ? "…" : ""}`;
    likeBtn.disabled = busy;
    likeBtn.style.opacity = busy ? "0.6" : "1";

    likeBtn.addEventListener("click", async () => {
      if (inflightLike.get(photo.id)) return;

      inflightLike.set(photo.id, true);
      render();

      try {
        await likeOnServer(photo);
      } catch (e) {
        console.warn("like error ⚠️", e);
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

  // 新しく見える分だけ batch で likes 取得
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
      src: cldThumb(String(publicId)),
      likes: 0,
    }));

  photos = uniquePrepend(photos, immediate);

  // 新規分だけ batch で likes 取得（基本0）
  await hydrateLikesFor(immediate);

  DISPLAY_LIMIT = Math.max(DISPLAY_LIMIT, 30);
  render();

  // list.json 同期（likes全件再取得しない）
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

    // 初回は表示分だけ likes を batch 取得
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
