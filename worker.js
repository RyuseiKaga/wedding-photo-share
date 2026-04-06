/**
 * wedding-like-api  —  Cloudflare Worker
 *
 * KV binding name: LIKES
 *
 * Endpoints:
 *   POST /likes              いいね +1
 *   POST /likes/batch        いいね数を一括取得（body: { ids: [...] }）
 *   GET  /likes/batch        いいね数を一括取得（?ids=id1,id2,...）
 *   GET  /hidden             削除済み写真IDリストを取得
 *   POST /hidden             削除済み写真IDを追加（body: { ids: [...] }）
 *   GET  /health             死活確認
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

const HIDDEN_KEY = "__hidden__";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function err(msg, status = 400) {
  return new Response(msg, { status, headers: CORS });
}

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // KV 未設定ガード
    if (!env.LIKES) {
      return err("KV binding 'LIKES' is not configured", 500);
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = request.method;

    // ----------------------------------------
    // GET /health
    // ----------------------------------------
    if (path === "/health" || path === "/") {
      return json({ ok: true });
    }

    // ----------------------------------------
    // POST /likes  —  いいね +1
    // ----------------------------------------
    if (path === "/likes" && method === "POST") {
      let body;
      try { body = await request.json(); } catch { return err("Invalid JSON"); }

      const id = body?.id;
      if (!id || typeof id !== "string") return err("Missing or invalid 'id'");

      const current = parseInt(await env.LIKES.get(id) || "0", 10);
      const next = current + 1;
      await env.LIKES.put(id, String(next));

      return json({ likes: next });
    }

    // ----------------------------------------
    // POST /likes/batch  —  一括取得（JSON body）
    // GET  /likes/batch  —  一括取得（クエリ文字列）
    // ----------------------------------------
    if (path === "/likes/batch") {
      let ids = [];

      if (method === "POST") {
        let body;
        try { body = await request.json(); } catch { return err("Invalid JSON"); }
        ids = Array.isArray(body?.ids) ? body.ids : [];
      } else if (method === "GET") {
        const raw = url.searchParams.get("ids") || "";
        ids = raw.split(",").map(s => s.trim()).filter(Boolean);
      } else {
        return err("Method Not Allowed", 405);
      }

      const result = {};
      await Promise.all(
        ids.map(async (id) => {
          const val = await env.LIKES.get(id);
          result[id] = val !== null ? parseInt(val, 10) : 0;
        })
      );

      return json({ likes: result });
    }

    // ----------------------------------------
    // GET /hidden  —  削除済みIDリストを返す
    // ----------------------------------------
    if (path === "/hidden" && method === "GET") {
      const raw = await env.LIKES.get(HIDDEN_KEY);
      let ids = [];
      try { ids = raw ? JSON.parse(raw) : []; } catch { ids = []; }

      return json({ ids });
    }

    // ----------------------------------------
    // POST /hidden  —  削除済みIDを追加（マージ）
    // ----------------------------------------
    if (path === "/hidden" && method === "POST") {
      let body;
      try { body = await request.json(); } catch { return err("Invalid JSON"); }

      const newIds = Array.isArray(body?.ids) ? body.ids.filter(v => typeof v === "string") : [];
      if (newIds.length === 0) return json({ ids: [] });

      const raw = await env.LIKES.get(HIDDEN_KEY);
      let current = [];
      try { current = raw ? JSON.parse(raw) : []; } catch { current = []; }

      const merged = Array.from(new Set([...current, ...newIds]));
      await env.LIKES.put(HIDDEN_KEY, JSON.stringify(merged));

      return json({ ids: merged });
    }

    // ----------------------------------------
    return err("Not Found", 404);
  },
};
