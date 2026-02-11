/* =========================
   CONFIG（ここだけ自分の値）
========================= */
const CLOUD_NAME = "dmei50xsu";
const LIST_NAME = "wedding_2026";          // .json無し
const UPLOAD_PRESET = "wedding_unsigned";
const UPLOAD_FOLDER = "";

const LIKE_API = "https://wedding-like-api.karo2kai.workers.dev";

// 速さ優先（体感ほぼ変わらない範囲で軽く）
const VIEW_TRANSFORM  = "c_limit,w_1600,q_auto:good,f_auto";
const THUMB_TRANSFORM = "c_fill,w_420,h_420,q_auto:good,f_auto";

const HIRES_TIMEOUT_MS = 60000;
const LIKES_BATCH_SIZE = 120;
const RENDER_CHUNK = 18;
const RESORT_DEBOUNCE_MS = 700;
const LIKE_LOCK_MS = 900;
const INITIAL_PLACEHOLDER_COUNT = 12;

const BULK_SHARE_TITLE = "Wedding Photos";
const BULK_SHARE_TEXT  = "写真を保存してください";

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
const $viewerClose = document.getElementById("viewerClose");
const $viewerImg = document.getElementById("viewerImg");
const $viewerLoading = document.getElementById("viewerLoading");
const $viewerOpen = document.getElementById("viewerOpen");
const $viewerCopy = document.getElementById("viewerCopy");

/* =========================
   STATE
========================= */
let allPhotos = []; // [{id, version, format, thumb, view, original}]
let renderIndex = 0;

const selected = new Set(); // photo.id
const likes = new Map();    // photo.id -> number

let io = null;
let viewerLoadToken = 0;

let resortTimer = null;
const likeLocks = new Map(); // id -> unlock time

// id -> { card, likeBtn, countEl, cb }
const uiById = new Map();

/* =========================
   Utils
========================= */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showOverlay(title, sub, progressText = "") {
  $overlayTitle.textContent = title || "処理中…";
  $overlaySub.textContent = sub || "しばらくお待ちください";
  $overlayProgress.textContent = progressText || "";
  $overlay.hidden = false;
  document.body.classList.add("is-busy");
}
function updateOverlay(progressText) {
  $overlayProgress.textContent = progressText || "";
}
function hideOverlay() {
  $overlay.hidden = true;
  document.body.classList.remove("is-busy");
}

// ✅ どんな経路でも必ず overlay を閉じるためのラッパ
async function withOverlay(title, sub, taskFn) {
  showOverlay(title, sub, "");
  try {
    return await taskFn();
  } finally {
    // 最強ガード：何が起きても閉じる
    hideOverlay();
  }
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

function setBulkBar() {
  const n = selected.size;
  $selectedCount.textContent = String(n);
  $bulkBar.hidden = (n === 0);
}

function setBulkSaveButtonState(state) {
  if (state === "preparing") {
    $bulkSave.disabled = true;
    $bulkSave.textContent = "準備中…";
  } else {
    $bulkSave.disabled = false;
    $bulkSave.textContent = "一括保存（カメラロール）";
  }
}

function isLikelyTouchDevice() {
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   Viewer：勝手に出ないガード
========================= */
function hardCloseViewer() {
  $viewer.hidden = true;
  $viewer.style.display = "none"; // BFCache対策

  $viewerLoading.hidden = true;
  $viewerImg.removeAttribute("src");

  viewerLoadToken++;

  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}
function closeViewer() { hardCloseViewer(); }

function bindLifecycleGuards() {
  // 共有シートから戻る / 戻る などで変な表示になったら強制的に閉じる・overlayも閉じる
  window.addEventListener("pageshow", () => {
    hardCloseViewer();
    hideOverlay(); // ✅ 残りっぱなし防止
    setBulkSaveButtonState("idle");
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      hardCloseViewer();
      hideOverlay(); // ✅ 残りっぱなし防止
      setBulkSaveButtonState("idle");
    }
  });
  window.addEventListener("focus", () => {
    hardCloseViewer();
    // overlayは「出てたら閉じる」だけ
    hideOverlay();
    setBulkSaveButtonState("idle");
  });
}

function preloadImage(url, timeoutMs = HIRES_TIMEOUT_MS) {
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

  // display none を戻す
  $viewer.style.display = "";
  $viewer.hidden = false;

  $viewerLoading.hidden = false;
  $viewerImg.removeAttribute("src");

  $viewerOpen.href = photo.original;
  $viewerCopy.dataset.url = photo.original;

  const token = ++viewerLoadToken;
  const hiUrl = photo.view;

  try {
    await preloadImage(hiUrl, HIRES_TIMEOUT_MS);
    if (token !== viewerLoadToken) return;

    $viewerImg.src = hiUrl;
    if ($viewerImg.decode) {
      try { await $viewerImg.decode(); } catch {}
    }
  } catch (e) {
    if (token !== viewerLoadToken) return;
    console.warn("viewer preload failed:", e);
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

  // POST /likes/batch
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
        else if (!likes.has(id)) likes.set(id, 0);
      }
      return;
    }
  } catch (e) {
    console.warn("likes batch POST failed", e);
  }

  // GET /likes/batch?ids=...
  try {
    const qs = encodeURIComponent(ids.join(","));
    const res = await fetch(`${LIKE_API}/likes/batch?ids=${qs}`);
    if (!res.ok) return;
    const data = await res.json();
    const obj = data?.likes || data || {};
    for (const id of ids) {
      const v = obj[id];
      if (typeof v === "number") likes.set(id, v);
      else if (!likes.has(id)) likes.set(id, 0);
    }
  } catch (e) {
    console.warn("likes batch GET failed", e);
  }
}

function updateLikeUI(id, count) {
  const ui = uiById.get(id);
  if (ui?.countEl) ui.countEl.textContent = String(count ?? 0);
}

function setLikeButtonDisabled(id, disabled) {
  const ui = uiById.get(id);
  if (!ui?.likeBtn) return;
  ui.likeBtn.disabled = !!disabled;
  ui.likeBtn.setAttribute("aria-disabled", disabled ? "true" : "false");
  ui.likeBtn.classList.toggle("is-locked", !!disabled);
}

function pulseLikeGlow(id) {
  const ui = uiById.get(id);
  if (!ui?.card) return;
  ui.card.classList.remove("like-pulse");
  void ui.card.offsetWidth; // reflow
  ui.card.classList.add("like-pulse");
  setTimeout(() => ui.card && ui.card.classList.remove("like-pulse"), 650);
}

function scheduleResort() {
  if (resortTimer) return;
  resortTimer = setTimeout(() => {
    resortTimer = null;
    resortByLikesAndRerender();
  }, RESORT_DEBOUNCE_MS);
}

async function postLike(id) {
  const now = Date.now();
  const until = likeLocks.get(id) || 0;
  if (now < until) return;

  likeLocks.set(id, now + LIKE_LOCK_MS);
  setLikeButtonDisabled(id, true);

  pulseLikeGlow(id);

  const next = (likes.get(id) || 0) + 1;
  likes.set(id, next);
  updateLikeUI(id, next);

  try {
    const res = await fetch(`${LIKE_API}/likes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      const data = await res.json();
      const serverCount =
        (typeof data?.likes === "number" && data.likes) ||
        (typeof data?.count === "number" && data.count) ||
        (typeof data?.value === "number" && data.value) ||
        (typeof data === "number" && data);

      if (typeof serverCount === "number") {
        likes.set(id, serverCount);
        updateLikeUI(id, serverCount);
      }
      scheduleResort();
    } else {
      console.warn("like failed:", res.status);
    }
  } catch (e) {
    console.warn("like error:", e);
  } finally {
    const remaining = Math.max(0, (likeLocks.get(id) || 0) - Date.now());
    setTimeout(() => {
      likeLocks.delete(id);
      setLikeButtonDisabled(id, false);
    }, remaining);
  }
}

/* =========================
   Render
========================= */
function buildPhotoCard(photo, isTop = false) {
  const card = document.createElement("div");
  card.className = isTop ? "card card--top" : "card";
  card.dataset.photoId = photo.id;

  const tile = document.createElement("div");
  tile.className = "tile";

  const img = document.createElement("img");
  img.className = "tile-img";
  img.loading = "lazy";
  img.alt = "photo";
  img.src = photo.thumb;

  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "tile-hit";
  hit.setAttribute("aria-label", "写真を開く");
  hit.addEventListener("click", () => openViewer(photo));

  const checkLabel = document.createElement("label");
  checkLabel.className = "tile-check";

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

  checkLabel.appendChild(cb);
  checkLabel.appendChild(cbText);

  tile.appendChild(img);
  tile.appendChild(hit);
  tile.appendChild(checkLabel);

  const meta = document.createElement("div");
  meta.className = "meta";

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = "like-btn";
  likeBtn.innerHTML = `❤ <span class="like-count">${likes.get(photo.id) || 0}</span>`;
  likeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    postLike(photo.id);
  });

  const countEl = likeBtn.querySelector(".like-count");
  meta.appendChild(likeBtn);

  card.appendChild(tile);
  card.appendChild(meta);

  uiById.set(photo.id, { card, likeBtn, countEl, cb });

  // lock状態復元
  const locked = (likeLocks.get(photo.id) || 0) > Date.now();
  if (locked) setLikeButtonDisabled(photo.id, true);

  return card;
}

function renderPlaceholders() {
  $gallery.innerHTML = "";
  uiById.clear();

  for (let i = 0; i < INITIAL_PLACEHOLDER_COUNT; i++) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="tile" style="background:#f3f4f6"></div>
      <div class="meta">
        <button class="like-btn" type="button" disabled aria-disabled="true">❤ <span class="like-count">…</span></button>
      </div>
    `;
    $gallery.appendChild(card);
  }
}

function renderNextChunk() {
  const end = Math.min(renderIndex + RENDER_CHUNK, allPhotos.length);
  if (renderIndex >= end) return false;

  const frag = document.createDocumentFragment();
  for (let i = renderIndex; i < end; i++) {
    frag.appendChild(buildPhotoCard(allPhotos[i], i === 0));
  }

  if (renderIndex === 0) $gallery.innerHTML = "";
  $gallery.appendChild(frag);

  renderIndex = end;
  return (renderIndex < allPhotos.length);
}

function setupInfiniteScroll() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const hasMore = renderNextChunk();
      if (!hasMore) io.disconnect();
    }
  }, { rootMargin: "900px 0px" });

  io.observe($sentinel);
}

function resortByLikesAndRerender() {
  allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

  $gallery.innerHTML = "";
  uiById.clear();
  renderIndex = 0;
  renderNextChunk();
  setupInfiniteScroll();
  setBulkBar();
}

/* =========================
   Load List（✅ overlayが残らないよう完全にfinally化）
========================= */
async function loadList() {
  renderPlaceholders();

  await withOverlay("読み込み中…", "いいねを取得して並び替えています", async () => {
    const url = jsonUrl();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`list json failed: ${res.status}`);

    const data = await res.json();
    const resources = Array.isArray(data?.resources) ? data.resources : [];

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
        original: cldUrl(meta, ""),
      };
    });

    const ids = allPhotos.map(p => p.id);
    const batches = chunk(ids, LIKES_BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
      updateOverlay(`${Math.min((i + 1) * LIKES_BATCH_SIZE, ids.length)} / ${ids.length}`);
      await fetchLikesBatch(batches[i]);
      // 万が一の例外に備えて、ここでUIスレッドに譲る（iOSの固まり防止）
      await sleep(0);
    }

    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;
    renderNextChunk();
    setupInfiniteScroll();
  });
}

/* =========================
   Upload（必要なら）
========================= */
async function uploadFiles(files) {
  if (!files || files.length === 0) return;

  await withOverlay("アップロード中…", "しばらくお待ちください", async () => {
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

    const newPhotos = uploaded.map(meta => {
      const m = { public_id: meta.public_id, version: meta.version, format: meta.format };
      return {
        id: meta.public_id,
        version: meta.version,
        format: meta.format,
        thumb: cldUrl(m, THUMB_TRANSFORM),
        view: cldUrl(m, VIEW_TRANSFORM),
        original: cldUrl(m, ""),
      };
    });

    for (const p of newPhotos) {
      if (!likes.has(p.id)) likes.set(p.id, 0);
    }

    allPhotos = [...newPhotos, ...allPhotos];
    allPhotos.sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0));

    $gallery.innerHTML = "";
    uiById.clear();
    renderIndex = 0;
    renderNextChunk();
    setupInfiniteScroll();
  });
}

/* =========================
   Bulk Save（✅ overlayが残らないよう完全にfinally化）
========================= */
async function buildFetchBlob(url, timeoutMs = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await res.blob();
  } finally {
    clearTimeout(t);
  }
}

async function shareFilesIfPossible(files) {
  if (!navigator.canShare || !navigator.share) return false;
  try {
    if (!navigator.canShare({ files })) return false;
    await navigator.share({
      title: BULK_SHARE_TITLE,
      text: BULK_SHARE_TEXT,
      files,
    });
    return true;
  } catch (e) {
    // ユーザーキャンセルもここに来る（それでもoverlayはfinallyで閉じる）
    console.warn("share canceled/failed:", e);
    return false;
  }
}

async function bulkSaveSelected() {
  const ids = Array.from(selected);
  if (ids.length === 0) return;

  setBulkSaveButtonState("preparing");

  try {
    const files = [];

    await withOverlay("一括保存の準備中…", "画像をまとめて用意しています", async () => {
      for (let i = 0; i < ids.length; i++) {
        updateOverlay(`${i + 1} / ${ids.length}`);

        const id = ids[i];
        const photo = allPhotos.find(p => p.id === id);
        if (!photo) continue;

        // view（軽め高画質）をBlob化 → shareへ
        const blob = await buildFetchBlob(photo.view, 90000);
        const ext = (blob.type && blob.type.includes("png")) ? "png" : "jpg";
        files.push(new File([blob], `photo_${i + 1}.${ext}`, { type: blob.type || "image/jpeg" }));

        // iOSで固まり防止
        await sleep(0);
      }
    });

    // overlayは withOverlay の finally で確実に閉じる

    // Share優先
    if (files.length > 0) {
      const ok = await shareFilesIfPossible(files);
      if (ok) return;
    }

    // フォールバック：順に開く
    if (isLikelyTouchDevice()) {
      alert("共有で一括保存できない端末でした。代わりにタブで画像を開きます。\n各画像を長押しして「写真に追加/画像を保存」してください。");
    }
    for (const id of ids) {
      const photo = allPhotos.find(p => p.id === id);
      if (!photo) continue;
      window.open(photo.view, "_blank", "noopener");
      await sleep(380);
    }
  } finally {
    // ✅ ここでも念押しで必ず閉じる（withOverlay外で例外が起きても残らない）
    hideOverlay();
    setBulkSaveButtonState("idle");
  }
}

/* =========================
   Events
========================= */
function bindEvents() {
  $fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
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

  $clearSelection.addEventListener("click", () => {
    selected.clear();
    for (const [, ui] of uiById) {
      if (ui?.cb) ui.cb.checked = false;
    }
    setBulkBar();
  });

  $bulkSave.addEventListener("click", async () => {
    try {
      await bulkSaveSelected();
    } catch (e) {
      console.error(e);
      hideOverlay();
      setBulkSaveButtonState("idle");
      alert("一括保存に失敗しました。通信が弱い場合は時間を置いて再試行してください。");
    }
  });

  $viewerClose.addEventListener("click", closeViewer);
  $viewerBackdrop.addEventListener("click", closeViewer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$viewer.hidden) closeViewer();
  });

  $viewerCopy.addEventListener("click", async () => {
    const url = $viewerCopy.dataset.url || "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      $viewerCopy.textContent = "コピーしました";
      await sleep(800);
      $viewerCopy.textContent = "URLコピー";
    } catch {
      prompt("コピーしてね", url);
    }
  });
}

/* =========================
   Boot
========================= */
async function boot() {
  // 起動・復帰時の残骸を消す
  hardCloseViewer();
  hideOverlay();
  setBulkSaveButtonState("idle");

  bindEvents();
  bindLifecycleGuards();

  try {
    await loadList();
  } catch (e) {
    console.error(e);
    hideOverlay();
    alert("写真一覧の読み込みに失敗しました。\nlist url = " + jsonUrl());
  }

  setBulkBar();
}

boot();
