const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// Cloudinary
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026";
const THUMB_SIZE = 600;

const gallery = document.getElementById("gallery");
const fileInput = document.getElementById("fileInput");

console.log("main.js loaded ✅", new Date().toISOString());
console.log("fileInput exists?", !!fileInput);

let photos = []; // { id(public_id), src, likes }
let lastTopId = null;
const inflightLike = new Map();

// -------- UI helpers --------
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

// -------- Cloudinary --------
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
    // 初回404などはあり得るので空のまま
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
  return json; // public_id, secure_url...
}

// -------- Workers likes --------
async function hydrateLikes(targetPhotos = photos) {
  for (const p of targetPhotos) {
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

// -------- merge helper (keep likes when reloading list) --------
function mergeKeepLikes(current, next) {
  const likeMap = new Map(current.map((p) => [p.id, p.likes]));
  return next.map((p) => ({ ...p, likes: likeMap.get(p.id) ?? p.likes ?? 0 }));
}

// -------- render --------
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

  const topPhotos = [...photos]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 9);

  const currentTopId = topPhotos[0]?.id;

  topPhotos.forEach((photo, index) => {
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
}

// -------- post-upload refresh strategy --------
// 1) まずアップロード結果の public_id を「即」画面に追加
// 2) その後 list.json を最大10回ポーリングして同期（反映遅延対策）
async function refreshAfterUpload(uploadResults) {
  // 即時反映（public_id を使って先に追加）
  const immediate = uploadResults
    .map((r) => r?.public_id)
    .filter(Boolean)
    .map((publicId) => ({
      id: String(publicId),
      src: cldThumb(String(publicId)),
      likes: 0,
    }));

  // 既にあるものは重複追加しない
  const existing = new Set(photos.map((p) => p.id));
  const toAdd = immediate.filter((p) => !existing.has(p.id));

  if (toAdd.length > 0) {
    photos = [...toAdd, ...photos]; // 新しいのを先頭に
    await hydrateLikes(toAdd); // likesはKVから（ほぼ0）
    render();
  }

  // list.json の反映遅延を吸収するためにポーリング
  for (let i = 0; i < 10; i++) {
    try {
      await sleep(700); // 少し待つ
      const data = await fetchCloudinaryListByTag(TAG);
      const next = normalizeFromListJson(data);
      const beforeCount = photos.length;

      photos = mergeKeepLikes(photos, next);
      await hydrateLikes(); // 既存含め整合

      render();

      // 追加した public_id が list に現れたら終了
      const ids = new Set(photos.map((p) => p.id));
      const allPresent = immediate.every((p) => ids.has(p.id));
      if (allPresent) {
        console.log("synced with list ✅");
        return;
      }

      // 何も変わらないのが続く場合も抜ける（無限回避）
      if (photos.length === beforeCount && i >= 4) {
        console.log("list not updated yet, stop retrying");
        return;
      }
    } catch (e) {
      console.warn("retry list sync ⚠️", i + 1, e?.message || e);
      // 途中失敗してもリトライ
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// -------- upload UI --------
fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  console.log("CHANGE FIRED ✅ files=", files.length);
  if (files.length === 0) return;

  try {
    // 1枚ずつアップロードして結果を集める
    const results = [];
    for (const f of files) {
      results.push(await uploadToCloudinary(f));
    }

    // アップロード後に「確実に反映」させる
    await refreshAfterUpload(results);
  } catch (err) {
    console.error(err);
    alert("アップロードに失敗しました。設定（CLOUD_NAME / UPLOAD_PRESET）と通信を確認してください。");
  } finally {
    fileInput.value = "";
  }
});

// -------- init --------
(async () => {
  await loadGalleryFromCloudinary();
  await hydrateLikes();
  render();
  console.log("list.json url =", listUrlByTag(TAG));
})();
