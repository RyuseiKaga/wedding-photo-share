// ========================
// Config（あなたの環境に合わせて）
// ========================
const API_BASE = "https://wedding-like-api.karo2kai.workers.dev"; // あなたのWorker URL
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";

// 表示
const THUMB_SIZE = 360;   // 一覧サムネ
const VIEW_W = 1600;      // タップ表示（ぱっと見十分高画質）
const OPEN_W = 3000;      // 保存用（ほぼ原寸だが重すぎない）

// 制限（事故防止）
const UPLOAD_LIMIT_FILES = 30;
const UPLOAD_LIMIT_MB = 25;
const UPLOAD_CONCURRENCY = 3;

const BULK_SAVE_LIMIT = 20;           // 一括保存（共有）最大枚数
const BULK_FETCH_CONCURRENCY = 2;     // Blob化の同時数（iPhone安定用）

// 無限スクロール
let DISPLAY_LIMIT = 30;
const STEP = 30;
const SCROLL_THRESHOLD_PX = 200;

// ========================
// DOM
// ========================
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

const bulkBar = document.getElementById("bulkBar");
const selectedCountEl = document.getElementById("selectedCount");
const bulkSaveBtn = document.getElementById("bulkSave");
const clearSelectionBtn = document.getElementById("clearSelection");

// ========================
// State
// ========================
let photos = []; // { id, thumb, view, open, likes }
let lastTopId = null;
let isLoadingMore = false;

const inflightLike = new Map();
const likesLoaded = new Set();

// 選択
const selected = new Set(); // photo.id

console.log("main.js loaded ✅", new Date().toISOString());

// ========================
// URL helpers (Cloudinary)
// ========================
function cldThumb(publicId) {
  // 一覧は軽く、f_autoで最適化
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_${THUMB_SIZE},h_${THUMB_SIZE},q_auto,f_auto/${publicId}`;
}

function cldView(publicId) {
  // Safari安定：JPG固定 + progressive + 上限
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_${VIEW_W},q_auto:good,f_jpg,fl_progressive/${publicId}`;
}

function cldOpen(publicId) {
  // 保存用：ほぼ原寸、でも重すぎ回避で上限
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_limit,w_${OPEN_W},q_auto:best,f_jpg,fl_progressive/${publicId}`;
}

function listUrlByTag(tag) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(tag)}.json`;
}

function uploadEndpoint() {
  return `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
}

// ========================
// UI helpers
// ========================
function showOverlay(sub, progressText = "") {
  uploadOverlay.hidden = false;
  document.body.classList.add("no-scroll");
  uploadOverlaySub.textContent = sub || "しばらくお待ちください";
  uploadOverlayProgress.textContent = progressText || "";

  uploadButtonLabel?.classList.add("is-disabled");
  if (fileInput) fileInput.disabled = true;
}

function hideOverlay() {
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

function updateBulkBar() {
  const count = selected.size;
  selectedCountEl.textContent = String(count);

  bulkBar.hidden = count === 0;
  bulkSaveBtn.disabled = count === 0;

  // ほんとに事故りやすいので制限表示
  if (count > BULK_SAVE_LIMIT) {
    bulkSaveBtn.disabled = true;
    bulkSaveBtn.textContent = `一括保存（最大${BULK_SAVE_LIMIT}枚）`;
  } else {
    bulkSaveBtn.textContent = "一括保存（カメラロール）";
  }
}

// ========================
// Cloudinary list
// ========================
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

// ========================
// Workers likes
// ========================
async function fetchLikesBatch(ids) {
  const res = await fetch(`${API_BASE}/likes/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`batch failed: ${res.status}`);
  return await res.json(); // { likes: {id:number} }
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

// ========================
// Viewer (プリロード方式 + ぐるぐる対策)
// ========================
function openViewer(photo) {
  viewer.hidden = false;
  document.body.classList.add("no-scroll");

  viewerOpen.href = photo.open;

  // まずサムネ
  viewerImg.src = photo.thumb;
  showViewerLoading();

  const highUrl = photo.view;

  // 世代管理（連打で古いonloadが残らない）
  const token = String(Date.now()) + Math.random().toString(16).slice(2);
  openViewer._token = token;

  const pre = new Image();
  pre.decoding = "async";
  pre.loading = "eager";

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

    viewerImg.src = highUrl;
    hideViewerLoading();

    // Safari保険
    requestAnimationFrame(() => hideViewerLoading());
    setTimeout(() => hideViewerLoading(), 120);
  };

  pre.onerror = () => {
    if (openViewer._token !== token) return;
    cleanup();
    hideViewerLoading();
    console.warn("High-res load failed:", highUrl);
  };

  pre.src = highUrl;
}

function closeViewer() {
  viewer.hidden = true;
  document.body.classList.remove("no-scroll");
  hideViewerLoading();
  viewerImg.src = "";
}

// ========================
// Upload speed improvement (条件付き圧縮)
// ========================
function validateUploadSelection(files) {
  if (files.length > UPLOAD_LIMIT_FILES) {
    throw new Error(`一度にアップロードできるのは最大 ${UPLOAD_LIMIT_FILES} 枚です`);
  }
  for (const f of files) {
    if (f.size > UPLOAD_LIMIT_MB * 1024 * 1024) {
      throw new Error(`"${f.name}" が大きすぎます（最大 ${UPLOAD_LIMIT_MB}MB）`);
    }
  }
}

// ぱっと見劣化がわからないライン（条件付きで圧縮）
async function compressIfNeeded(file, opts = {}) {
  const MAX_DIM = opts.maxDim ?? 2560;
  const QUALITY = opts.quality ?? 0.86;
  const BYPASS_MAX_MB = opts.bypassMaxMB ?? 2.5;

  const meta = await readImageMeta(file).catch(() => null);
  if (meta) {
    const maxSide = Math.max(meta.width, meta.height);
    if (maxSide <= MAX_DIM && file.size <= BYPASS_MAX_MB * 1024 * 1024) {
      return file; // 小さくて軽いなら劣化ゼロ
    }
  }

  const img = await loadImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  const maxSide = Math.max(width, height);
  const scale = Math.min(1, MAX_DIM / maxSide);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  // 小さくて軽いならそのまま
  if (scale === 1 && file.size <= BYPASS_MAX_MB * 1024 * 1024) return file;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return file;

  // 圧縮しても減らないなら元を使う（無駄な再圧縮を避ける）
  if (blob.size >= file.size * 0.95) return file;

  return new File([blob], normalizeJpgName(file.name), { type: "image/jpeg" });
}

function normalizeJpgName(name) {
  return name.replace(/\.(heic|heif|png|webp)$/i, ".jpg");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function readImageMeta(file) {
  const img = await loadImage(file);
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
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

async function uploadFilesWithConcurrency(files, concurrency, uploadFn, onProgress) {
  let idx = 0;
  let done = 0;
  const results = [];

  async function worker() {
    while (idx < files.length) {
      const current = idx++;
      const r = await uploadFn(files[current], current);
      results[current] = r;
      done++;
      onProgress?.(done, files.length, files[current]?.name);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ========================
// Bulk save (ZIPなし / iPhone優先：共有シート)
// ========================
async function runWithConcurrency(taskFns, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < taskFns.length) {
      const current = idx++;
      results[current] = await taskFns[current]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, taskFns.length) }, () => worker())
  );
  return results;
}

async function bulkSaveSelected() {
  const ids = Array.from(selected);

  if (ids.length === 0) return;
  if (ids.length > BULK_SAVE_LIMIT) {
    alert(`一括保存は最大 ${BULK_SAVE_LIMIT} 枚までです`);
    return;
  }

  // Web Share API（ファイル共有）が使えるか
  const canShareFiles = !!navigator.share && !!navigator.canShare;

  showOverlay("高画質画像を準備しています", `0 / ${ids.length}`);

  try {
    let done = 0;
    const tasks = ids.map((id) => async () => {
      const url = cldOpen(id);
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);

      const blob = await resp.blob();
      done++;
      uploadOverlayProgress.textContent = `${done} / ${ids.length}`;

      const fileName = `${id.split("/").pop()}.jpg`;
      return new File([blob], fileName, { type: blob.type || "image/jpeg" });
    });

    const files = await runWithConcurrency(tasks, BULK_FETCH_CONCURRENCY);

    hideOverlay();

    if (canShareFiles && navigator.canShare({ files })) {
      // 共有シート → 「画像を保存」でまとめて保存しやすい
      await navigator.share({
        files,
        title: "写真を保存",
        text: "写真を保存します",
      });

      // 共有後は選択解除
      selected.clear();
      updateBulkBar();
      render();
      return;
    }

    // フォールバック（共有が無理な場合）
    alert("この端末では一括保存（共有）ができません。順番に開くので、各画像で長押しして保存してください。");
    for (const id of ids) {
      window.open(cldOpen(id), "_blank", "noopener");
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (e) {
    console.warn(e);
    hideOverlay();
    alert("一括保存の準備に失敗しました（通信/端末制限の可能性）。");
  }
}

// ========================
// Render
// ========================
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

    // selected ring
    if (selected.has(photo.id)) card.classList.add("is-selected");

    const img = document.createElement("img");
    img.src = photo.thumb;
    img.alt = photo.id;
    img.loading = "lazy";
    img.decoding = "async";

    // 画像タップでビューア
    img.addEventListener("click", () => openViewer(photo));

    // 選択トグル（右上）
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "select-toggle" + (selected.has(photo.id) ? " is-on" : "");
    toggle.innerHTML = `<span>${selected.has(photo.id) ? "✓" : ""}</span>`;

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (selected.has(photo.id)) selected.delete(photo.id);
      else selected.add(photo.id);

      updateBulkBar();
      render(); // 表示更新（リング/チェック）
    });

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
        await likeOnServer(photo);
      } catch (err) {
        console.warn("like error:", err);
        photo.likes = Math.max(0, photo.likes - 1);
      } finally {
        inflightLike.set(photo.id, false);
        render();
      }
    });

    card.appendChild(img);
    card.appendChild(toggle);
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

// ========================
// Infinite scroll
// ========================
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

// ========================
// Upload refresh
// ========================
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

  // list反映ラグ対策
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

// ========================
// Init / events
// ========================
document.addEventListener("DOMContentLoaded", async () => {
  // viewer close
  viewerClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeViewer();
  });

  viewer?.addEventListener("click", (e) => {
    if (e.target && e.target.classList?.contains("viewer-backdrop")) closeViewer();
  });

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

  // bulk bar actions
  clearSelectionBtn?.addEventListener("click", () => {
    selected.clear();
    updateBulkBar();
    render();
  });

  bulkSaveBtn?.addEventListener("click", async () => {
    await bulkSaveSelected();
  });

  // infinite scroll
  window.addEventListener("scroll", () => { onScroll(); }, { passive: true });

  // initial load
  showOverlay("写真を読み込んでいます", "");
  try {
    const data = await fetchCloudinaryListByTag(TAG);
    const next = normalizeFromListJson(data);
    photos = mergeKeepLikes(photos, next);

    render();

    // 最初に見える分だけlikes取得（高速化）
    const sorted = [...photos].sort((a, b) => b.likes - a.likes);
    await hydrateLikesFor(sorted.slice(0, DISPLAY_LIMIT));
    render();
  } catch (e) {
    console.warn("init error:", e);
    render();
  } finally {
    hideOverlay();
  }

  // upload
  fileInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      validateUploadSelection(files);
    } catch (err) {
      alert(err.message || String(err));
      fileInput.value = "";
      return;
    }

    showOverlay("アップロード準備中…", `0 / ${files.length}`);

    try {
      const results = await uploadFilesWithConcurrency(
        files,
        UPLOAD_CONCURRENCY,
        async (f) => {
          const optimized = await compressIfNeeded(f, { maxDim: 2560, quality: 0.86, bypassMaxMB: 2.5 });
          return await uploadToCloudinary(optimized);
        },
        (done, total, name) => {
          uploadOverlaySub.textContent = name ? `アップロード中：${name}` : "アップロード中…";
          uploadOverlayProgress.textContent = `${done} / ${total}`;
        }
      );

      await refreshAfterUpload(results);
    } catch (err) {
      console.error(err);
      alert("アップロードに失敗しました。通信/Cloudinary設定を確認してください。");
    } finally {
      hideOverlay();
      fileInput.value = "";
    }
  });
});
