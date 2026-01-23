const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// Cloudinary
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";
const THUMB_SIZE = 600;

const gallery = document.getElementById("gallery");
const fileInput = document.getElementById("fileInput");

// Overlay DOM
const uploadOverlay = document.getElementById("uploadOverlay");
const uploadOverlaySub = document.getElementById("uploadOverlaySub");
const uploadOverlayProgress = document.getElementById("uploadOverlayProgress");
const uploadButtonLabel = document.querySelector(".upload-button");

console.log("main.js loaded ✅", new Date().toISOString());
console.log("fileInput exists?", !!fileInput);
console.log("uploadOverlay exists?", !!uploadOverlay);

// ---------- Infinite scroll settings ----------
let DISPLAY_LIMIT = 30;
const STEP = 30;
const SCROLL_THRESHOLD_PX = 200;

// ---------- State ----------
let photos = []; // { id(public_id), src, likes }
let lastTopId = null;
const inflightLike = new Map();
let isLoadingMore = false;

// ---------- Overlay helpers ----------
function showOverlay(sub, progressText) {
  if (!uploadOverlay) return;

  uploadOverlay.hidden = false;
  uploadOverlay.style.pointerEvents = "auto"; // block interactions
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
  if (uploadOverlaySub) {
    uploadOverlaySub.textContent = fileName ? `アップロード中：${fileName}` : "しばらくお待ちください";
  }
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
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_${THUMB_SIZE},h_${THUMB_SIZE},q_auto,f_auto/${publicId}`;
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
  const url = listUrlByTag(tag);
  console.log("list fetch ->", url);

  const res = await fetch(url, { cache: "no-store" });
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
    console.log("list ok ✅ resources=", photos.length);
  } catch (err) {
    console.warn("list error ⚠️", err?.message || err);
    photos = photos || [];
  }
}

async function uploadToCloudinary(file) {
  const endpoint = uploadEndpoint();
  console.log("upload start ->", endpoint, file?.name, file?.size);

  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("tags", TAG);

  const res = await fetch(endpoint, { method: "POST", body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  console.log("upload done ✅ public_id=", json.public_id);
  return json;
}

// ---------- Workers likes ----------
async function hydrateLikes(target = photos) {
  for (const p of target) {
    try {
      const res = await fetch(`${API_BASE}/likes?id=${encodeURIComponent(p.id)}`);
      const data = await res.json();
      p.likes = Number(data.likes) || 0;
    } catch {
      // ignore
    }
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
function onScroll() {
  if (isLoadingMore) return;

  const nearBottom =
    window.innerHeight + window.scrollY >= document.body.offsetHeight - SCROLL_THRESHOLD_PX;

  if (!nearBottom) return;

  isLoadingMore = true;
  DISPLAY_LIMIT += STEP;
  render();

  setTimeout(() => {
    isLoadingMore = false;
    render();
  }, 200);
}

window.addEventListener("scroll", onScroll, { passive: true });

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
  await hydrateLikes(immediate);

  DISPLAY_LIMIT = Math.max(DISPLAY_LIMIT, 30);
  render();

  for (let i = 0; i < 10; i++) {
    try {
      await sleep(700);
      const data = await fetchCloudinaryListByTag(TAG);
      const next = normalizeFromListJson(data);
      photos = mergeKeepLikes(photos, next);
      await hydrateLikes();
      render();

      const ids = new Set(photos.map((p) => p.id));
      const allPresent = immediate.every((p) => ids.has(p.id));
      if (allPresent) {
        console.log("synced with list ✅");
        return;
      }
    } catch (e) {
      console.warn("retry list sync ⚠️", i + 1, e?.message || e);
    }
  }
}

// ---------- Upload UI ----------
fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  console.log("CHANGE FIRED ✅ files=", files.length);
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

// ---------- Init (show overlay while loading) ----------
(async () => {
  showLoadingInitial();
  try {
    await loadGalleryFromCloudinary();
    await hydrateLikes();
    render();
    console.log("list.json url =", listUrlByTag(TAG));
  } catch (e) {
    console.warn("init error ⚠️", e);
    render();
  } finally {
    hideOverlay();
  }
})();
