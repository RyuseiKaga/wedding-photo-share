// ==============================
// 設定
// ==============================
const API_BASE = "https://wedding-like-api.karo2kai.workers.dev";

// ==============================
// ダミー写真データ
// ※ id は後で Cloudinary public_id に置き換える
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
let lastTopId = null;

// ==============================
// ユーティリティ
// ==============================
function getCrown(rank) {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  return "";
}

// ==============================
// Workers から like 数を取得
// ==============================
async function hydrateLikes() {
  for (const p of photos) {
    try {
      const res = await fetch(
        `${API_BASE}/likes?id=${encodeURIComponent(p.id)}`
      );
      const data = await res.json();
      p.likes = Number(data.likes) || 0;
    } catch {
      // 通信失敗時は 0 のまま
    }
  }
}

// ==============================
// Workers に like を送信
// ==============================
async function sendLike(photo) {
  const res = await fetch(`${API_BASE}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: photo.id }),
  });
  const data = await res.json();
  photo.likes = data.likes;
}

// ==============================
// 描画
// ==============================
function render() {
  gallery.innerHTML = "";

  const topPhotos = [...photos]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 9);

  const currentTopId = topPhotos[0]?.id;

  topPhotos.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = "photo-card";

    // 🥇 1位演出
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
    likeBtn.textContent = `${getCrown(index)} ❤️ ${photo.likes}`;

    likeBtn.addEventListener("click", async () => {
      // 楽観的UI（即反映）
      photo.likes += 1;
      render();

      try {
        await sendLike(photo);
        render();
      } catch {
        // 失敗したら巻き戻し
        photo.likes -= 1;
        render();
        alert("通信に失敗しました。もう一度押してください。");
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
