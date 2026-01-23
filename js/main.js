export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ---- CORS (GitHub Pages などから叩く前提) ----
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // KVバインド名：LIKES_KV を想定
    const KV = env.LIKES_KV;
    if (!KV) {
      return json({ error: "LIKES_KV binding is missing" }, 500, corsHeaders);
    }

    try {
      // ----------------------------
      // GET /likes?id=PUBLIC_ID
      // ----------------------------
      if (request.method === "GET" && pathname === "/likes") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "missing id" }, 400, corsHeaders);

        const raw = await KV.get(id);
        const likes = raw ? Number(raw) : 0;

        return json({ id, likes }, 200, corsHeaders);
      }

      // ----------------------------
      // POST /like  { id }
      // ----------------------------
      if (request.method === "POST" && pathname === "/like") {
        const body = await safeJson(request);
        const id = body?.id;
        if (!id) return json({ error: "missing id" }, 400, corsHeaders);

        // KVは原子的インクリメントがないので read-modify-write
        // 今回は「何回押してもOK」なので衝突は許容（厳密にしたいなら Durable Object 推奨）
        const raw = await KV.get(id);
        const next = (raw ? Number(raw) : 0) + 1;
        await KV.put(id, String(next));

        return json({ id, likes: next }, 200, corsHeaders);
      }

      // ----------------------------
      // POST /likes/batch  { ids: [id1,id2,...] }
      // ----------------------------
      if (request.method === "POST" && pathname === "/likes/batch") {
        const body = await safeJson(request);
        const ids = Array.isArray(body?.ids) ? body.ids : null;

        if (!ids) return json({ error: "missing ids (array)" }, 400, corsHeaders);

        // 念のため制限（過剰リクエストを避ける）
        // UI的には 30〜60程度を想定
        const uniqueIds = Array.from(new Set(ids.map(String))).slice(0, 300);

        // 並列取得（過剰並列を避けて分割）
        const likesById = {};
        const chunkSize = 50;

        for (let i = 0; i < uniqueIds.length; i += chunkSize) {
          const chunk = uniqueIds.slice(i, i + chunkSize);
          const values = await Promise.all(chunk.map((id) => KV.get(id)));

          for (let j = 0; j < chunk.length; j++) {
            const id = chunk[j];
            const raw = values[j];
            likesById[id] = raw ? Number(raw) : 0;
          }
        }

        return json({ likes: likesById }, 200, corsHeaders);
      }

      return json({ error: "Not Found" }, 404, corsHeaders);
    } catch (e) {
      return json(
        { error: "Server error", message: String(e?.message || e) },
        500,
        corsHeaders,
      );
    }
  },
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

async function safeJson(request) {
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}
