document.addEventListener("DOMContentLoaded", () => {
  const gallery = document.getElementById("gallery");

  // ダミー写真データ（後で Cloudinary + KV に差し替える前提）
  let photos = [
    { id: 1, src: "https://placehold.co/600x600?text=Photo+1", likes: 12 },
    { id: 2, src: "https://placehold.co/600x600?text=Photo+2", likes: 3 },
    { id: 3, src: "https://placehold.co/600x600?text=Photo+3", likes: 25 },
    { id: 4, src: "https://placehold.co/600x600?text=Photo+4", likes: 8 },
    { id: 5, src: "https://placehold.co/600x600?text=Photo+5", likes: 17 },
    { id: 6, src: "https://placehold.co/600x600?text=Photo+6", likes: 1 },
    { id: 7, src: "https://placehold.co/600x600?text=Photo+7", likes: 30 },
    { id: 8, src: "https://placehold.co/600x600?text=Photo+8", likes: 6 },
    { id: 9, src: "https://placehold.co/600x600?text=Photo+9", likes: 14 },
    { id: 10, src: "https://placehold.co/600x600?text=Photo+10", likes: 9 }
  ];

  // 前回の1位ID（入れ替わり検知用）
  let lastTopId = null;

  function getCrown(rank) {
    if (rank === 0) return "🥇";
    if (rank === 1) return "🥈";
    if (rank === 2) return "🥉";
    return "";
  }

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

      // 1位演出
      if (index === 0) {
        card.classList.add("rank-1");

        // 1位が入れ替わった瞬間だけポップ
        if (lastTopId !== null && lastTopId !== photo.id) {
          card.classList.add("pop");
        }
      }

      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = `photo ${photo.id}`;

      const likeBtn = document.createElement("button");
      likeBtn.className = "like";
      likeBtn.textContent = `${getCrown(index)} ❤️ ${photo.likes}`;

      likeBtn.addEventListener("click", () => {
        photo.likes += 1;
        render(); // 即ランキング更新
      });

      card.appendChild(img);
      card.appendChild(likeBtn);
      gallery.appendChild(card);
    });

    lastTopId = currentTopId;
  }

  // 初回描画
  render();
});
