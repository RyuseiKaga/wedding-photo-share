/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // Cloudinary list の名前（wedding_2026.json）
const UPLOAD_PRESET = "wedding_unsigned";  // Cloudinary unsigned preset
const UPLOAD_FOLDER = "";                  // 使ってなければ空でOK（例: "wedding_2026"）

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev"; // ←あなたのWorkers URL

// Cloudinary 変換（あなたが preset で通したやつ）
const VIEW_TRANSFORM = "c_limit,w_1800,q_auto:eco";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

/* =========================
   DOM
========================= */
const $gallery = document.getElementById("gallery");
const $fileInput = document.getElementById("fileInput");
const $sentinel = document.getElementById("sentinel");

const $bulkBar = document.getElementById("bulkBar");
const $selectedCount = document.getElementById("selectedCount");
const $clearSelection = document.getElementById("clearSelection");
const $bulkSave = document.getElementById("bulkSave");

const $overlay = document.getElementById("uploadOverlay");
const $overlayTitle = document.getElementById("uploadOverlayTitle");
const $overlaySub = document.getElementById("uploadOverlaySub");
const $overlayProgress = document.getElementById("uploadOverlayProgress");

const $viewer = document.getElementById("viewer");
const $viewerBackdrop = $viewer.querySelector(".viewer-backdrop");
const $viewerSheet = $viewer.querySelector(".viewer-sheet");
const $viewerClose = document.getElementById("viewerClose");
const $viewerImg = document.getElementById("viewerImg");
const $viewerLoading = document.getElementById("viewerLoading");
const $viewerOpen = document.getElementById("viewerOpen");
const $viewerCopy = document.getElementById("viewerCopy");

/* =========================
   STATE
========================= */
let allPhotos = [];           // [{id, version, format, thumb, view, original}]
let renderIndex = 0;
const RENDER_CHUNK = 18;

const selected = new Set();  // photo.id
const likes = new Map();     // photo.id -> number

let io = null;
let viewerOpenPhoto = null;
let viewerLoadToken = 0;

/* =========================
   Utils
========================= */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showOverlay(title, sub, progressText = "") {
  $overlayTitle.textContent = title || "処理中…";
  $overlaySub.textContent = sub || "しばらくお待ちください";
  $overlayProgress.textContent = progressText || "";
  $overlay.hidden = false;
  document.documentElement.style.overflow = "hidden";
}
function updateOverlay(progressText) {
  $overlayProgress.textContent = progressText || "";
}
function hideOverlay() {
  $overlay.hidden = true;
  document.documentElement.style.overflow = "";
}

function jsonUrl() {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(LIST_NAME)}.json`;
}

function cldUrl({ public_id, version, format }, transform = "") {
  const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;
  const tr = transform ? `${transform}/` : "";
  const v = version ? `v${version}/` : "";
  const ext = format ? `.${format}` : "";
  return `${base}${tr}${v}${public_id}${ext}`;
}

function safeText(s) {
  return (s ?? "").toString();
}

function setBulkBar() {
  const n = selected.size;
  $selectedCount.textContent = String(n);
  $bulkBar.hidden = (n === 0);
}

function isLikelyTouchDevice() {
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

/* =========================
   Viewer (NO auto open)
========================= */
function forceViewerClosedOnLoad() {
  // 起動時に絶対閉じる
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  viewerOpenPhoto = null;

  // #photo=... みたいなハッシュが残ってると自動オープン実装がある場合があるので消す
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function closeViewer() {
  $viewer.hidden = true;
  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");
  viewerOpenPhoto = null;
}

async function preloadImage(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;

    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("preload timeout"));
    }, timeoutMs);

    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(true);
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(new Error("preload error"));
    };
    img.src = url;
  });
}

async function openViewer(photo) {
  if (!photo) return;
  viewerOpenPhoto = photo;

  // viewerはタップ時のみ開く
  $viewer.hidden = false;
  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  // ボタンは先に埋める
  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  // 競合防止（連打で古い読み込みが反映されないように）
  const token = ++viewerLoadToken;
  const hiUrl = photo.view;

  try {
    await preloadImage(hiUrl, 30000);
    if (token !== viewerLoadToken) return; // 新しい表示が始まってたら無視

    // ここで初めて src をセット
    $viewerImg.src = hiUrl;

    // decode() が使えるなら待つ（描画タイミング安定）
    if ($viewerImg.decode) {
      try { await $viewerImg.decode(); } catch {}
    }
  } catch (e) {
    // 高画質が死んでも原寸ボタンで逃がす
    console.warn("viewer preload failed:", e);
    if (token !== viewerLoadToken) return;
    // フォールバックでサムネでも見えるように
    $viewerImg.src = photo.thumb;
  } finally {
    if (token !== viewerLoadToken) return;
    $viewerLoading.hidden = true;
  }
}

/* =========================
   Likes API
========================= */
async function fetchLikesBatch(ids) {
  if (!ids.length) return;

  // POST /likes/batch を優先（あなたが言ってたやつ）
  try {
    const res = await fetch(`${LIKE_API}/likes/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    if (res.ok) {
      const data = await res.json();
      const obj = data?.likes || data || {};
      for (const id of ids) {
        const v = obj[id];
        if (typeof v === "number") likes.set(id, v);
      }
      return;
    }
  } catch (e) {
    console.warn("POST /likes/batch failed:", e);
  }

  // フォールバック：GET /likes/batch?ids=a,b,c
  try {
    const qs = encodeURIComponent(ids.join(","));
    const res = await fetch(`${LIKE_API}/likes/batch?ids=${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    const obj = data?.likes || data || {};
    for (const id of ids) {
      const v = obj[id];
      if (typeof v === "number") likes.set(id, v);
    }
  } catch (e) {
    console.warn("GET /likes/batch failed:", e);
  }
}

async function postLike(id) {
  // ローカル即反映（何回押せてもOK）
  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  // サーバ反映
  // 1) POST /likes {id} を試す
  try {
    const res = await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const data = await res.json();
      // {likes: n} / {count:n} / 直接 number など、形が違っても吸収
      const serverCount =
        (typeof data?.likes === "number" && data.likes) ||
        (typeof data?.count === "number" && data.count) ||
        (typeof data?.value === "number" && data.value) ||
        (typeof data === "number" && data);

      if (typeof serverCount === "number") {
        likes.set(id, serverCount);
        updateLikeUI(id, serverCount);
      }
      return;
    }
  } catch (e) {
    console.warn("POST /likes failed:", e);
  }

  // 2) だめなら POST /likes/{id}
  try {
    const res = await fetch(`${LIKE_API}/likes/${encodeURIComponent(id)}`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    const serverCount =
      (typeof data?.likes === "number" && data.likes) ||
      (typeof data?.count === "number" && data.count) ||
      (typeof data === "number" && data);
    if (typeof serverCount === "number") {
      likes.set(id, serverCount);
      updateLikeUI(id, serverCount);
    }
  } catch (e) {
    console.warn("POST /likes/:id failed:", e);
  }
}

function updateLikeUI(id, count) {
  const el = document.querySelector(`[data-like-count="${CSS.escape(id)}"]`);
  if (el) el.textContent = String(count ?? 0);
}

/* =========================
   Render
========================= */
function buildPhotoCard(photo) {
  const card = document.createElement("div");
  card.className = "photo-card";
  card.dataset.photoId = photo.id;

  // 画像
  const imgWrap = document.createElement("button");
  imgWrap.type = "button";
  imgWrap.className = "photo-thumb";
  imgWrap.setAttribute("aria-label", "写真を開く");
  imgWrap.style.backgroundImage = `url("${photo.thumb}")`;

  imgWrap.addEventListener("click", () => {
    openViewer(photo);
  });

  // 選択
  const selectRow = document.createElement("label");
  selectRow.className = "photo-select";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selected.has(photo.id);
  cb.addEventListener("change", () => {
    if (cb.checked) selected.add(photo.id);
    else selected.delete(photo.id);
    setBulkBar();
  });

  const cbText = document.createElement("span");
  cbText.textContent = "選択";
  selectRow.appendChild(cb);
  selectRow.appendChild(cbText);

  // いいね
  const likeRow = document.createElement("div");
  likeRow.className = "photo-like";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "like-btn";
  likeBtn.innerHTML = "❤";
  likeBtn.addEventListener("click", () => postLike(photo.id));

  const likeCount = document.createElement("span");
  likeCount.className = "like-count";
  likeCount.dataset.likeCount = photo.id;
  likeCount.textContent = String(likes.get(photo.id) || 0);

  likeRow.appendChild(likeBtn);
  likeRow.appendChild(likeCount);

  card.appendChild(imgWrap);
  card.appendChild(selectRow);
  card.appendChild(likeRow);

  return card;
}

function renderNextChunk() {
  const end = Math.min(renderIndex + RENDER_CHUNK, allPhotos.length);
  if (renderIndex >= end) return false;

  const frag = document.createDocumentFragment();
  for (let i = renderIndex; i < end; i++) {
    frag.appendChild(buildPhotoCard(allPhotos[i]));
  }
  $gallery.appendChild(frag);
  renderIndex = end;
  return (renderIndex < allPhotos.length);
}

function setupInfiniteScroll() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      // 追加描画
      const hasMore = renderNextChunk();
      if (!hasMore) io.disconnect();
    }
  }, { rootMargin: "800px 0px" });

  io.observe($sentinel);
}

/* =========================
   Load Cloudinary list
========================= */
async function loadList() {
  showOverlay("読み込み中…", "写真一覧を取得しています", "");

  const res = await fetch(jsonUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(`list json failed: ${res.status}`);
  const data = await res.json();

  const resources = Array.isArray(data?.resources) ? data.resources : [];
  // 最新が上になるように（version or created_at があればそれを優先）
  resources.sort((a, b) => (b.version || 0) - (a.version || 0));

  allPhotos = resources.map(r => {
    const id = r.public_id;
    const version = r.version;
    const format = r.format || "jpg";
    const meta = { public_id: id, version, format };

    return {
      id,
      version,
      format,
      thumb: cldUrl(meta, THUMB_TRANSFORM),
      view: cldUrl(meta, VIEW_TRANSFORM),
      original: cldUrl(meta, ""), // 原寸（変換なし）
    };
  });

  // いいねを先にまとめて取得（最初の分だけでもOK）
  const firstIds = allPhotos.slice(0, Math.min(120, allPhotos.length)).map(p => p.id);
  await fetchLikesBatch(firstIds);

  // 描画
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();
}

/* =========================
   Upload
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  showOverlay("アップロード中…", "画面は操作できません", `0 / ${files.length}`);

  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    updateOverlay(`${i + 1} / ${files.length}`);

    const file = files[i];
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", UPLOAD_PRESET);
    if (UPLOAD_FOLDER) fd.append("folder", UPLOAD_FOLDER);

    const up = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: fd,
    });

    if (!up.ok) {
      const t = await up.text().catch(() => "");
      throw new Error(`upload failed: ${up.status} ${t}`);
    }

    const data = await up.json();
    uploaded.push({
      public_id: data.public_id,
      version: data.version,
      format: data.format || "jpg",
    });
  }

  // アップロード直後は list json 反映に時間がかかることがある
  // なので ①今回分はその場で先頭に差し込む ②あとで list を再読込
  const newPhotos = uploaded.map(meta => ({
    id: meta.public_id,
    version: meta.version,
    format: meta.format,
    thumb: cldUrl(meta, THUMB_TRANSFORM),
    view: cldUrl(meta, VIEW_TRANSFORM),
    original: cldUrl(meta, ""),
  }));

  // 新規を先頭に
  allPhotos = [...newPhotos, ...allPhotos];
  // いいね初期値
  for (const p of newPhotos) likes.set(p.id, likes.get(p.id) || 0);

  // 画面を描画し直し（軽く）
  $gallery.innerHTML = "";
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();

  hideOverlay();

  // list json が追いつくまで少し待って再取得（任意）
  // await sleep(1500);
  // try { await loadList(); } catch {}
}

/* =========================
   Bulk Save (best effort)
========================= */
async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  // iOS/ブラウザ制限：複数タブや自動DLがブロックされやすい
  showOverlay("一括保存の準備中…", "端末によっては複数回タップが必要です", `${ids.length} 枚`);

  // まず原寸URLを順に開く（ポップアップブロックされる場合あり）
  // なるべくブロック回避のため少し間隔を空ける
  let opened = 0;

  hideOverlay();

  for (const id of ids) {
    const photo = allPhotos.find(p => p.id === id);
    if (!photo) continue;
    window.open(photo.original, "_blank", "noopener");
    opened++;
    await sleep(450);
  }

  if (opened === 0) {
    alert("保存対象が見つかりませんでした。");
  } else {
    // iOS向け説明
    if (isLikelyTouchDevice()) {
      alert("タブで原寸画像を開きました。各画像を長押しして「写真に追加/画像を保存」してください。");
    }
  }
}

/* =========================
   Events
========================= */
function bindEvents() {
  // Upload
  $fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    // 同じファイルを再度選べるようにクリア
    e.target.value = "";
    if (!files.length) return;

    try {
      await uploadFiles(files);
    } catch (err) {
      console.error(err);
      hideOverlay();
      alert("アップロードに失敗しました。電波が弱い場合は枚数を減らして試してください。");
    }
  });

  // Bulk selection
  $clearSelection.addEventListener("click", () => {
    selected.clear();
    // 画面上のチェックも外す
    document.querySelectorAll('.photo-select input[type="checkbox"]').forEach(cb => cb.checked = false);
    setBulkBar();
  });

  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      alert("一括保存の準備に失敗しました（端末制限の可能性）。");
    }
  });

  // Viewer close
  $viewerClose.addEventListener("click", closeViewer);
  $viewerBackdrop.addEventListener("click", closeViewer);

  // Esc close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$viewer.hidden) closeViewer();
  });

  // URL copy
  $viewerCopy.addEventListener("click", async () => {
    const url = $viewerCopy.dataset.url || "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      $viewerCopy.textContent = "コピーしました";
      await sleep(800);
      $viewerCopy.textContent = "URLコピー";
    } catch {
      // フォールバック
      prompt("コピーしてね", url);
    }
  });
}

/* =========================
   Boot
========================= */
async function boot() {
  // ✅ 絶対に起動時にviewerを閉じる（自動オープン禁止）
  forceViewerClosedOnLoad();

  bindEvents();

  try {
    await loadList();
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("写真一覧の読み込みに失敗しました。Cloudinary list JSON が開けるか確認してください。");
  }

  setBulkBar();
}

boot();
