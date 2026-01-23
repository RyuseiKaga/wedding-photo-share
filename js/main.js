// ==============================
// 設定
// ==============================
const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// ==============================
// ダミー写真データ
// ※ id は後で Cloudinary public_id に置き換える前提
// ==============================
let photos = [
  { id: "photo1", src: "https://placehold.co/600x600?text=Photo+1", likes: 0 },
  { id: "photo2", src: "https://placehold.co/600x600?text=Photo+2", likes: 0 },
  { id: "photo3", src: "https://placehold.co/600x600?text=Photo+3", likes: 0 },
  { id: "photo4", src: "https://placehold.co/600x600?text=Photo+4", likes: 0 },
  { id: "photo5", src: "https://placehold.co/600x600?text=Photo+5", likes: 0 },
  { id: "photo6", src: "https://placehold.co/600x600?text=Photo+6", likes: 0 },
  { id: "photo7", src: "https://placehold.co/600x600?text=Photo+7", likes: 0 },
  { id: "photo8", src: "https://placehold.co/600x600?text=Photo+8", likes: 0 },
  { id: "photo9", src: "https://placehold.co/600x600?text=Photo+9", likes: 0 },
  { id: "photo10", src: "https://placehold.co/600x600?text=Photo+10", likes: 0 },
];

// ==============================
// DOM
// ==============================
const gallery = document.getElementById("gallery");

// 1位入れ替わり検知
let lastTopId = null;

// 連打・同時クリックの破綻防止（写真ごとに通信中フラグ）
const inflight = new Map();

// ==============================
// 表示ユーティリティ
// ==============================
function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

// ==============================
// Workers: like数取得（初期化）
// ==============================
async function hydrateLikes() {
  for (const p of photos) {
    try {
      const res = await fetch(`${API_BASE}/likes?id=${encodeURIComponent(p.id)}`);
      const data = await res.json();
      p.likes = Number(data.likes) || 0;
    } catch {
      // 失敗時は0のまま
    }
  }
}

// ==============================
// Workers: like +1（サーバ結果を正とする）
// ==============================
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
// 描画
// ==============================
function render() {
  gallery.innerHTML = "";

  // likes降順 → 上位9件
  const topPhotos = [...photos]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 9);

  const currentTopId = topPhotos[0]?.id;

  topPhotos.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    // 1位演出（CSSの rank-1 / pop を利用）
    if (index === 0) {
      card.classList.add("rank-1");

      // 1位が入れ替わった瞬間だけ pop
      if (lastTopId && lastTopId !== photo.id) {
        card.classList.add("pop");
      }
    }

    const img = document.createElement("img");
    img.src = photo.src;
    img.alt = photo.id;

    const likeBtn = document.createElement("button");
    likeBtn.className = "like";

    const busy = inflight.get(photo.id) === true;
    likeBtn.textContent = `${getCrown(index)} ❤️ ${photo.likes}${busy ? "…" : ""}`;
    likeBtn.disabled = busy;
    likeBtn.style.opacity = busy ? "0.6" : "1";

    likeBtn.addEventListener("click", async () => {
      // 連打防止
      if (inflight.get(photo.id)) return;

      inflight.set(photo.id, true);
      render(); // "…" 表示に切り替え

      try {
        // 表示は必ずサーバ結果に合わせる（戻る/減る問題の根治）
        await likeOnServer(photo);
      } catch {
        // 失敗時は何もしない（必要なら alert を入れてOK）
        // alert("通信に失敗しました。もう一度押してください。");
      } finally {
        inflight.set(photo.id, false);
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
// 初期化
// ==============================
(async () => {
  await hydrateLikes();
  render();
})();
