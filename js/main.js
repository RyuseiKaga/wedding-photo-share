/* =========================================================
  Wedding Photo Share - main.js (v65系)
  - Cloudinary list JSON -> gallery
  - Upload (unsigned preset)
  - Infinite scroll
  - Likes via Cloudflare Workers + KV (LIKES_KV binding)
  - Viewer with preload + timeout (no infinite spinner)
  - Bulk select & bulk save (with limits)
========================================================= */

/* ====== ✅ あなたの環境に合わせる設定 ====== */
const CLOUD_NAME = "dmei50xsu";               // Cloudinary cloud name
const LIST_NAME = "wedding_2026";             // image/list/<LIST_NAME>.json
const UPLOAD_PRESET = "wedding_unsigned";     // unsigned upload preset name

// Cloudflare Workers (あなたのURL)
const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

// 表示用変換（Cloudinary）
const TRANS_THUMB = "c_fill,w_640,h_640,q_auto:eco,f_auto"; // サムネ（スクエア表示）
const TRANS_VIEW  = "c_limit,w_1800,q_auto:eco,f_auto";     // ビュー（高画質寄り・重すぎない）

/* ====== 制限（要望：制限つける） ====== */
const MAX_UPLOAD_FILES_PER_BATCH = 20; // 1回のアップロード最大
const MAX_BULK_SAVE = 20;             // 一括保存の最大枚数
const RENDER_PAGE_SIZE = 24;          // 無限スクロールの1回描画枚数

/* ====== アップロード軽量化（速度改善） ====== */
const COMPRESS_MAX_EDGE = 2200; // 長辺最大
const COMPRESS_JPEG_QUALITY = 0.86; // “ぱっと見劣化わからない”寄り

/* ====== 状態 ====== */
let photos = [];                // 全写真
let rendered = 0;               // 描画済み数
let likeCounts = new Map();     // id -> count
let inFlightLike = new Set();   // like更新中
let selected = new Set();       // 選択中 id
let io = null;                 // IntersectionObserver
let sentinel = null;           // 無限スクロール用

/* ====== DOM ====== */
const $gallery = () => document.getElementById("gallery");
const $fileInput = () => document.getElementById("fileInput");
const $bulkBar = () => document.getElementById("bulkBar");
const $selectedCount = () => document.getElementById("selectedCount");
const $clearSelection = () => document.getElementById("clearSelection");
const $bulkSave = () => document.getElementById("bulkSave");

// overlay
const $overlay = () => document.getElementById("uploadOverlay");
const $overlaySub = () => document.getElementById("uploadOverlaySub");
const $overlayProgress = () => document.getElementById("uploadOverlayProgress");

// viewer
const $viewer = () => document.getElementById("viewer");
const $viewerImg = () => document.getElementById("viewerImg");
const $viewerLoading = () => document.getElementById("viewerLoading");
const $viewerClose = () => document.getElementById("viewerClose");
const $viewerOpen = () => document.getElementById("viewerOpen");
const $viewerCopy = () => document.getElementById("viewerCopy");

/* =========================================================
  Utils
========================================================= */
function cloudBase() {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;
}
function listUrl() {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(LIST_NAME)}.json`;
}

// Cloudinary URL builder
function buildCloudinaryUrl(publicId, format, version, transformation) {
  const v = version ? `v${version}/` : "";
  const ext = format ? `.${format}` : "";
  const t = transformation ? `${transformation}/` : "";
  return `${cloudBase()}/${t}${v}${publicId}${ext}`;
}

function showOverlay(title = "処理中…", sub = "しばらくお待ちください", progress = "") {
  const o = $overlay();
  if (!o) return;
  document.body.classList.add("is-busy");
  o.hidden = false;
  const subEl = $overlaySub();
  const progEl = $overlayProgress();
  const titleEl = o.querySelector(".overlay-title");
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;
  if (progEl) progEl.textContent = progress;
}
function hideOverlay() {
  const o = $overlay();
  if (!o) return;
  o.hidden = true;
  document.body.classList.remove("is-busy");
  const progEl = $overlayProgress();
  if (progEl) progEl.textContent = "";
}

function toast(msg, ms = 1800) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.bottom = "92px";
  el.style.transform = "translateX(-50%)";
  el.style.padding = "10px 12px";
  el.style.background = "rgba(17,24,39,.92)";
  el.style.color = "#fff";
  el.style.borderRadius = "12px";
  el.style.fontWeight = "800";
  el.style.fontSize = "13px";
  el.style.zIndex = "9999";
  el.style.maxWidth = "88vw";
  el.style.textAlign = "center";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeResources(json) {
  // Cloudinary list JSON usually:
  // { resources: [{ public_id, format, version, ... }], ... }
  if (!json) return [];
  if (Array.isArray(json.resources)) return json.resources;
  if (Array.isArray(json)) return json;
  return [];
}

function photoIdFromResource(r) {
  // public_id はスラッシュ含む場合あり
  return r.public_id;
}

function makePhotoFromResource(r) {
  const id = photoIdFromResource(r);
  const format = r.format || "jpg";
  const version = r.version;

  const thumb = buildCloudinaryUrl(id, format, version, TRANS_THUMB);
  const view  = buildCloudinaryUrl(id, format, version, TRANS_VIEW);

  // “原寸”は transform なし（重い場合は view を使う）
  const original = buildCloudinaryUrl(id, format, version, "");

  return {
    id,
    publicId: id,
    format,
    version,
    thumb,
    view,
    original,
  };
}

/* =========================================================
  Likes API
  - graceful fallback if Worker routes differ
========================================================= */
async function apiPost(path, body) {
  const url = `${LIKE_API}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = safeJsonParse(text);
  if (!res.ok) {
    const msg = data?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchLikesBatch(ids) {
  if (!ids.length) return new Map();

  // Try /likes/batch then fallback /likesBatch then /likes
  const candidates = [
    { path: "/likes/batch", body: { ids } },
    { path: "/likesBatch", body: { ids } },
    { path: "/likes", body: { ids } }, // some implementations accept ids on /likes
  ];

  for (const c of candidates) {
    try {
      const data = await apiPost(c.path, c.body);
      // expected: { counts: {id: number, ...} } OR { data: {...} }
      const counts = data?.counts || data?.data || data;
      const m = new Map();
      if (counts && typeof counts === "object") {
        for (const id of ids) {
          const v = counts[id];
          if (typeof v === "number") m.set(id, v);
        }
      }
      return m;
    } catch (e) {
      // try next
    }
  }
  return new Map();
}

async function incrementLike(id, delta = 1) {
  // Try /likes then /like
  const candidates = [
    { path: "/likes", body: { id, delta } },
    { path: "/like", body: { id, delta } },
  ];

  for (const c of candidates) {
    try {
      const data = await apiPost(c.path, c.body);
      // expected: { count: number }
      const count = data?.count;
      if (typeof count === "number") return count;
      // or { counts: { [id]: n } }
      const maybe = data?.counts?.[id];
      if (typeof maybe === "number") return maybe;
      // if unknown, return null
      return null;
    } catch (e) {
      // try next
    }
  }
  return null;
}

/* =========================================================
  Render
========================================================= */
function updateBulkBar() {
  const n = selected.size;
  const bar = $bulkBar();
  if (!bar) return;
  bar.hidden = n === 0;
  const c = $selectedCount();
  if (c) c.textContent = String(n);
}

function buildPhotoCard(photo) {
  // card
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = photo.id;

  // tile (square)
  const tile = document.createElement("div");
  tile.className = "tile";

  const img = document.createElement("img");
  img.className = "tile-img";
  img.src = photo.thumb;
  img.alt = "photo";
  img.loading = "lazy";
  img.decoding = "async";

  // Tap area (open viewer)
  const hit = document.createElement("button");
  hit.className = "tile-hit";
  hit.type = "button";
  hit.addEventListener("click", () => openViewer(photo));

  // checkbox (selection)
  const checkWrap = document.createElement("label");
  checkWrap.className = "tile-check";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selected.has(photo.id);
  cb.addEventListener("change", () => {
    if (cb.checked) selected.add(photo.id);
    else selected.delete(photo.id);
    updateBulkBar();
  });

  const checkText = document.createElement("span");
  checkText.textContent = "選択";

  checkWrap.appendChild(cb);
  checkWrap.appendChild(checkText);

  tile.appendChild(img);
  tile.appendChild(hit);
  tile.appendChild(checkWrap);

  // meta row (likes)
  const meta = document.createElement("div");
  meta.className = "meta";

  const likeBtn = document.createElement("button");
  likeBtn.className = "like-btn";
  likeBtn.type = "button";
  likeBtn.setAttribute("aria-label", "いいね");

  const heart = document.createElement("span");
  heart.textContent = "❤";
  heart.style.color = "#ff2d55";

  const count = document.createElement("span");
  count.className = "like-count";
  count.textContent = String(likeCounts.get(photo.id) ?? 0);

  likeBtn.appendChild(heart);
  likeBtn.appendChild(count);

  likeBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    // ローカル即反映（要望）
    const cur = likeCounts.get(photo.id) ?? 0;
    likeCounts.set(photo.id, cur + 1);
    count.textContent = String(cur + 1);

    // サーバへ（失敗してもUIは戻さない：何回押せてもOK要件）
    if (inFlightLike.has(photo.id)) return;
    inFlightLike.add(photo.id);
    try {
      const serverCount = await incrementLike(photo.id, 1);
      if (typeof serverCount === "number") {
        likeCounts.set(photo.id, serverCount);
        count.textContent = String(serverCount);
      }
    } catch {
      // ignore
    } finally {
      inFlightLike.delete(photo.id);
    }
  });

  meta.appendChild(likeBtn);

  card.appendChild(tile);
  card.appendChild(meta);

  return card;
}

function renderNextBatch() {
  const g = $gallery();
  if (!g) return;

  const end = Math.min(rendered + RENDER_PAGE_SIZE, photos.length);
  for (let i = rendered; i < end; i++) {
    g.appendChild(buildPhotoCard(photos[i]));
  }
  rendered = end;

  ensureSentinel();
}

function ensureSentinel() {
  const g = $gallery();
  if (!g) return;

  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    sentinel.style.width = "100%";
    sentinel.id = "sentinel";
    g.appendChild(sentinel);
  } else {
    // keep at end
    g.appendChild(sentinel);
  }

  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          if (rendered < photos.length) {
            renderNextBatch();
          }
        }
      }
    }, { rootMargin: "800px 0px" });
    io.observe(sentinel);
  }
}

/* =========================================================
  Viewer (preload + timeout)
========================================================= */
function closeViewer() {
  const v = $viewer();
  const img = $viewerImg();
  const loading = $viewerLoading();
  if (loading) loading.hidden = true;
  if (img) {
    img.onload = null;
    img.onerror = null;
    img.src = "";
  }
  if (v) v.hidden = true;
}

function preloadThenSet(url, imgEl, onDone) {
  const pre = new Image();
  pre.onload = () => {
    imgEl.src = url;
    onDone?.(true);
  };
  pre.onerror = () => onDone?.(false);
  pre.src = url;
}

function openViewer(photo) {
  const viewer = $viewer();
  const img = $viewerImg();
  const loading = $viewerLoading();
  const openBtn = $viewerOpen();
  const copyBtn = $viewerCopy();
  if (!viewer || !img || !loading || !openBtn || !copyBtn) return;

  viewer.hidden = false;
  loading.hidden = false;

  const originalUrl = photo.original || photo.originalUrl || photo.url || "";
  const viewUrl = photo.view || photo.viewUrl || originalUrl;

  // Buttons
  openBtn.href = originalUrl || viewUrl || "#";
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(openBtn.href);
      toast("URLコピーしました");
    } catch {
      alert("コピーに失敗しました");
    }
  };

  // reset image handlers
  img.onload = null;
  img.onerror = null;
  img.src = "";

  // must finish (no infinite spinner)
  const TIMEOUT_MS = 12000;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    loading.hidden = true;
  };

  const timer = setTimeout(() => {
    finish();
    // fallback to original if view failed
    if (viewUrl !== originalUrl && originalUrl) {
      preloadThenSet(originalUrl, img, () => {});
    }
  }, TIMEOUT_MS);

  preloadThenSet(viewUrl, img, (ok) => {
    clearTimeout(timer);
    finish();
    if (!ok && originalUrl && originalUrl !== viewUrl) {
      // try original
      loading.hidden = false;
      preloadThenSet(originalUrl, img, () => finish());
    }
  });
}

/* =========================================================
  Upload (Cloudinary unsigned)
========================================================= */
async function compressImageIfPossible(file) {
  // If browser can't decode (HEIC etc.), fallback to original
  try {
    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    const maxEdge = Math.max(w, h);

    if (maxEdge <= COMPRESS_MAX_EDGE) {
      // small enough, return original
      return { blob: file, filename: file.name, type: file.type || "image/jpeg" };
    }

    const scale = COMPRESS_MAX_EDGE / maxEdge;
    const nw = Math.round(w * scale);
    const nh = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, nw, nh);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", COMPRESS_JPEG_QUALITY);
    });

    if (!blob) throw new Error("toBlob failed");
    const safeName = file.name.replace(/\.(heic|heif|png|webp|jpg|jpeg)$/i, ".jpg");
    return { blob, filename: safeName, type: "image/jpeg" };
  } catch {
    return { blob: file, filename: file.name, type: file.type || "application/octet-stream" };
  }
}

async function uploadOneToCloudinary(file, index, total) {
  const { blob, filename, type } = await compressImageIfPossible(file);

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("upload_preset", UPLOAD_PRESET);

  // optional: put into folder
  // form.append("folder", "wedding");

  showOverlay("アップロード中…", "写真を送信しています", `${index + 1} / ${total}`);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: form,
  });

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    throw new Error(data?.error?.message || `${res.status} upload failed`);
  }

  // data.public_id, format, version
  return data;
}

async function handleUpload(files) {
  if (!files || !files.length) return;

  const arr = Array.from(files);
  if (arr.length > MAX_UPLOAD_FILES_PER_BATCH) {
    toast(`一度にアップロードできるのは最大 ${MAX_UPLOAD_FILES_PER_BATCH} 枚です`);
    arr.length = MAX_UPLOAD_FILES_PER_BATCH;
  }

  try {
    showOverlay("アップロード準備中…", "写真を最適化しています", "");
    // Upload sequential to be stable on mobile networks
    const uploaded = [];
    for (let i = 0; i < arr.length; i++) {
      const data = await uploadOneToCloudinary(arr[i], i, arr.length);
      uploaded.push(data);
    }

    toast("アップロード完了！");
    // reload list and re-render from top
    await refreshList(true);
  } catch (e) {
    alert(`アップロードに失敗しました：${e.message || e}`);
  } finally {
    hideOverlay();
    const input = $fileInput();
    if (input) input.value = "";
  }
}

/* =========================================================
  Bulk save
========================================================= */
function getSelectedPhotos() {
  const ids = Array.from(selected);
  const map = new Map(photos.map(p => [p.id, p]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

async function downloadBlob(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("download failed");
  return await res.blob();
}

async function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename || "photo.jpg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function guessFilename(photo, i) {
  const safe = photo.publicId.split("/").pop().replace(/[^\w\-]+/g, "_");
  const ext = photo.format || "jpg";
  return `wedding_${String(i + 1).padStart(2, "0")}_${safe}.${ext}`;
}

async function bulkSaveSelected() {
  const items = getSelectedPhotos();
  if (!items.length) return;

  if (items.length > MAX_BULK_SAVE) {
    alert(`一括保存は最大 ${MAX_BULK_SAVE} 枚までです（選択：${items.length} 枚）`);
    return;
  }

  try {
    showOverlay("一括保存の準備中…", "通信状況によって時間がかかることがあります", `0 / ${items.length}`);

    // iOS Safariは最初の1回が失敗/許可系になりがちなので先に案内
    // （ユーザーが言ってた「1回目だけメッセージ→2回目成功」対策）
    toast("保存がブロックされたら、もう一度「一括保存」を押してください", 2600);

    for (let i = 0; i < items.length; i++) {
      const p = items[i];

      // “原寸”は重い場合があるので、保存用は view を優先（画質劣化が分かりにくい程度）
      const saveUrl = p.original || p.view;

      // できるだけ速く：まずは view を blob で保存（オリジナルが重すぎると詰まる）
      const blob = await downloadBlob(saveUrl);
      await triggerDownload(blob, guessFilename(p, i));

      const prog = $overlayProgress();
      if (prog) prog.textContent = `${i + 1} / ${items.length}`;
    }

    toast("保存リクエストを送信しました");
  } catch (e) {
    alert("一括保存の準備に失敗しました（通信/端末制限の可能性）。\n必要なら枚数を減らして試してください。");
  } finally {
    hideOverlay();
  }
}

/* =========================================================
  Load list + Likes
========================================================= */
async function refreshList(reset = false) {
  // Load list JSON
  const url = listUrl();

  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  const json = safeJsonParse(text);

  if (!res.ok || !json) {
    hideOverlay();
    alert("Cloudinaryの一覧JSONが読み込めませんでした。LIST_NAME / Cloud name を確認してください。");
    return;
  }

  const resources = normalizeResources(json);
  const list = resources
    .map(makePhotoFromResource)
    .filter(p => p.id && p.thumb);

  // 新しい順にしたい場合（versionがあれば）
  list.sort((a, b) => (b.version || 0) - (a.version || 0));

  photos = list;

  // Likes batch fetch (best effort)
  const ids = photos.slice(0, 200).map(p => p.id); // 最初は200枚までまとめて
  const serverLikes = await fetchLikesBatch(ids);
  for (const [id, c] of serverLikes.entries()) likeCounts.set(id, c);

  if (reset) {
    // Clear gallery and re-render
    const g = $gallery();
    if (g) g.innerHTML = "";
    rendered = 0;
    sentinel = null;
    if (io) { io.disconnect(); io = null; }
    renderNextBatch();
  } else if (rendered === 0) {
    renderNextBatch();
  }

  hideOverlay();
}

/* =========================================================
  Boot
========================================================= */
function bindUI() {
  // stop viewer being stuck on load (safety)
  closeViewer();
  hideOverlay();

  // Upload
  const input = $fileInput();
  if (input) {
    input.addEventListener("change", (e) => {
      const files = e.target.files;
      handleUpload(files);
    });
  }

  // bulk
  $clearSelection()?.addEventListener("click", () => {
    selected.clear();
    // update all checkboxes
    document.querySelectorAll('#gallery input[type="checkbox"]').forEach((cb) => cb.checked = false);
    updateBulkBar();
  });

  $bulkSave()?.addEventListener("click", () => {
    bulkSaveSelected();
  });

  // viewer close
  $viewerClose()?.addEventListener("click", closeViewer);
  document.querySelector("#viewer .viewer-backdrop")?.addEventListener("click", closeViewer);

  // ESC close (PC)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeViewer();
  });
}

async function boot() {
  bindUI();

  // 初回ロード中のオーバーレイ
  showOverlay("読み込み中…", "写真を準備しています", "");

  await refreshList(true);

  // もし0件ならメッセージ
  if (!photos.length) {
    toast("まだ写真がありません。アップロードしてみてください。", 2200);
  }
}

boot().catch((e) => {
  hideOverlay();
  alert(`初期化に失敗しました：${e.message || e}`);
});
