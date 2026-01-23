// ==============================
// 設定（ここだけ確認）
// ==============================
const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// Cloudinary
const CLOUD_NAME = "dmei50xsu";
const UPLOAD_PRESET = "wedding_unsigned";
const TAG = "wedding_2026"; // list.json で使うタグ

// サムネイルのサイズ（好みで）
const THUMB_SIZE = 600;

// ==============================
// DOM
// ==============================
const gallery = document.getElementById("gallery");
const fileInput = document.getElementById("fileInput");

console.log("main.js loaded ✅", new Date().toISOString());
console.log("fileInput exists?", !!fileInput);

// いいね連打/二重送信防止
const inflightLike = new Map();

// 1位入れ替わり演出用
let lastTopId = null;

// 現在表示する写真配列
// { id: public_id, src: thumbUrl, likes: number }
let photos = [];

// ==============================
// ユーティリティ
// ==============================
function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

function cldThumb(publicId) {
  // Cloudinary変換URL（サムネ）
  // f_auto,q_auto で軽量化、c_fillで正方形
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/c_fill,w_${THUMB_SIZE},h_${THUMB_SIZE},q_auto,f_auto/${publicId}`;
}

function listUrlByTag(tag) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/list/${encodeURIComponent(tag)}.json`;
}

function uploadEndpoint() {
  return `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
}

// ==============================
// Cloudinary: tag一覧（Client-side asset lists）
// ==============================
async function fetchCloudinaryListByTag(tag) {
  const url = listUrlByTag(tag);
  console.log("list fetch ->", url);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 404 は「タグ付きが0枚」でも起きます（初回は正常になりがち）
    throw new Error(`Cloudinary list failed: ${res.status} ${text}`);
  }
  return await res.json(); // { resources: [...] }
}

async function loadGalleryFromCloudinary() {
  try {
    const data = await fetchCloudinaryListByTag(TAG);
    const resources = Array.isArray(data.resources) ? data.resources : [];

    photos = resources
      .map((r) => r.public_id)
      .filter(Boolean)
      .map((publicId) => ({
        id: String(publicId),
        src: cldThumb(String(publicId)),
        likes: 0,
      }));

    console.log("list ok ✅ resources=", photos.length);
  } catch (err) {
    console.warn("list error ⚠️", err?.message || err);
    // listが404の場合：まだ0枚 or SecurityでResource listがブロック
    // いったん空表示で進める
    photos = [];
  }
}

// ==============================
// Cloudinary: アップロード（Unsigned）
// ==============================
async function uploadToCloudinary(file) {
  const endpoint = uploadEndpoint();
  console.log("upload start ->", endpoint, file?.name, file?.size);

  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("tags", TAG); // ここで必ずタグ付与（Presetにタグ欄が無くてもOK）

  const res = await fetch(endpoint, { method: "POST", body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  console.log("upload done ✅ public_id=", json.public_id);
  return json; // public_id 等
}

// ==============================
// Workers: like数 取得
// ==============================
async function hydrateLikes() {
  for (const p of photos) {
    try {
      const res = await fetch(`${API_BASE}/likes?id=${encodeURIComponent(p.id)}`);
      const data = await res.json();
      p.likes = Number(data.likes) || 0;
    } catch {
      // 失敗時はそのまま
    }
  }
}

// Workers: like +1（表示はサーバ結果のみ）
async function likeOnServer(photo) {
  const res = await fetch(`${API_BASE}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: photo.id }),
  });
  const data = await res.json();
  photo.likes = Number(data.likes) || photo.likes;
}

// ==============================
// 描画（TOP9 + 1位演出）
// ==============================
function render() {
  gallery.innerHTML = "";

  // 画像が0件のときの表示
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

    // 1位演出
    if (index === 0) {
      card.classList.add("rank-1");
      if (lastTopId && lastTopId !== photo.id) {
        card.classList.add("pop");
      }
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

// ==============================
// アップロードUI
// ==============================
fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  console.log("CHANGE FIRED ✅ files=", files.length);

  if (files.length === 0) return;

  // 連続アップロード（1枚ずつ）
  try {
    for (const f of files) {
      await uploadToCloudinary(f);
    }
  } catch (err) {
    console.error(err);
    alert("アップロードに失敗しました。設定（CLOUD_NAME / UPLOAD_PRESET）と通信を確認してください。");
  } finally {
    // 同じファイルを連続で選べるようにクリア
    fileInput.value = "";
  }

  // アップロード後：一覧再取得→likes反映→描画
  try {
    await loadGalleryFromCloudinary();
    await hydrateLikes();
    render();
  } catch (err) {
    console.warn("post-upload refresh error ⚠️", err);
  }
});

// ==============================
// 起動
// ==============================
(async () => {
  // 初期表示：一覧取得→likes反映→描画
  await loadGalleryFromCloudinary();
  await hydrateLikes();
  render();

  // 参考：list.json のURLをConsoleに出す（確認用）
  console.log("list.json url =", listUrlByTag(TAG));
})();
