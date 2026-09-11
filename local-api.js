"use strict";
/* 壁打ちトーク — PC非依存版の「サーバーの代わり」
 *
 * 元の server.py がやっていたこと(Groq呼び出し・ログ保存・テーマ管理)を、
 * そのままブラウザ側で行う。index.html の UI は一切変えず、
 *   fetch(API + "api/xxx")  →  api("api/xxx")
 * の置き換えだけで動くよう、fetch と同じ形(ok / json() / text())を返す。
 *
 * 保存先は localStorage。PCのファイルは使わないので自宅PCが落ちていても動く。
 * Groq APIキーは端末ごとに手入力(このコードには含めない)。
 */

const GROQ = "https://api.groq.com/openai/v1";
const CHAT_MODEL = "llama-3.3-70b-versatile";
const STT_MODEL = "whisper-large-v3-turbo";

const K_KEY = "kabeuchi_groq_key";
const K_SESS = "kabeuchi_sessions";
const K_STOCK = "kabeuchi_stocks";
const K_TOPICS = "kabeuchi_topics";

// ---------- プロンプト(server.py と同一) ----------

const SYSTEM_PROMPT = `あなたは「思考の壁打ち相手」。ユーザーは手作業(ゲーム等)をしながら考え事を声に出しているが、それは単なる背景であり話題ではない。ユーザーが口にした内容だけが話題。手元の作業やゲームには一切触れない(ユーザー自身がその話をした時だけ乗る)。画面はほぼ見ていないので、返答は音声で聞いて分かるものにする。

ルール:
- 日本語。1〜3文、読み上げて15秒以内に収まる短さ。箇条書き・記号・絵文字は使わない。
- 型: 軽い相槌 → 要点の言い換え or 一歩深い視点 → 深掘り質問をひとつ。毎回この型に縛られすぎず自然に。
- 説教・一般論の長い解説はしない。ユーザーの思考を進めるのが仕事。
- 入力は音声の文字起こしなので誤変換がある。文脈で補って解釈し、聞き返しは本当に分からない時だけ。
- 話題はなんでも受ける(就活、研究、人生、アイデア出し)。話題を選ぶのも広げる起点も常にユーザーの発言。`;

const SUMMARY_PROMPT = `以下はユーザーが考え事を声に出しながらAIと壁打ちしたセッションの記録。
これを本人が後で読み返すためのメモにまとめて。Markdownで以下の構成:

## 話したテーマ
(1行ずつ)
## 出た考え・アイデア
(本人の言葉をなるべく残す)
## 深まった論点
(問いと、どこまで考えが進んだか)
## 次に考えること
(未解決の問い・宿題)

簡潔に、ただし本人の思考の流れが再現できる程度には具体的に。`;

const DIVERGE_PROMPT = `あなたはユーザーが1つのテーマを深掘りするための「話し相手」。今日のテーマは「{topic}」。
目的は結論を出すことではなく、そのテーマを構成する要素をできるだけ多く・細かく引き出すこと。まとめや評価は後の工程でやるので、ここではやらない。

ルール:
- 日本語。1〜2文、読み上げて12秒以内。箇条書き・記号・絵文字は使わない。
- 毎回かならず質問で終える。質問は次のどれかを状況に応じて選ぶ。
  (a) 他にどんな要素があるか
  (b) 今出た要素は、さらに何と何に分けられるか
  (c) そこに数字はあるか(金額・人数・回数・時間・距離)
  (d) 自分は実際にどう判断して、どこで外したか
  (e) 同じ構造が他の分野にもないか
  (f) その前と後で自分の行動が何か変わったか。それが無かったらどうなっていたか
- 質問に例を添えるときは、ユーザーが直前に口にした固有名詞・場面・言葉をそのまま使って作る。「公の場」「プロとして」のような一般名詞のカテゴリを自分で持ち出さない。ユーザーの話に無い枠組みを当てはめない。
- ユーザーが質問の意味を聞き返したら(「どういうこと」「わからない」)、抽象語で言い直さない。直前の発言そのものを材料に「例えば、○○と○○みたいに」と具体で示してから、同じ質問をもう一度する。
- 体験や感情の話では(b)を無理に使わない。いつ・誰が・自分が何をしたか・その前後で何が変わったかに分けるほうが具体が出る。
- 説教や一般論の解説はしない。手元の作業やゲームには一切触れない。
- 入力は音声の文字起こしなので誤変換がある。文脈で補って解釈する。`;

const STRUCTURE_PROMPT = `以下は「{topic}」について本人が声に出して話したログ。これを面接で使える1枚に整理する。
Markdownで下の構成。本人の言葉と具体を残し、一般論で埋めない。ログに無いことは推測で足さず「未取得」と書く。

## 要素分解
(このテーマを構成する要素を最低5つ。粒度は「攻撃と守備」ではなく「FW・MF・DF」のレベルまで下げる)
## 数字
(金額・人数・回数・時間。ログにあるものだけ。無ければ「未取得: 何を測れば埋まるか」を書く)
## 自分の判断と失敗
(本人が実際に何を選び、どこで外したか)
## 他分野との共通構造
(同じ構造が見られる別の領域と、その対応関係)
## まだ埋まっていない穴
(次に調べる・人に聞くべきこと。相手にぶつける仮説の形で1〜3個)`;

const SPAWN_PROMPT = `以下は「{topic}」について本人が声に出して話したログ。
この中から、本題そのものではないが「別テーマとして単独で深掘りする価値がある」話題を抜き出す。

条件:
- 本人が実際に口にした話だけ。ログに無いテーマを創作しない。
- 自分の体験・数字・判断が伴っているものを優先する。一般論しか言えないテーマは出さない。
- 既存テーマと重複するものは出さない。既存: {existing}
- 該当なしなら空配列。最大3件。

JSONの配列だけを出力する。前置きも説明も付けない。
[{"name":"20字以内のテーマ名","opener":"最初に話すことを一文で","why":"掘る価値がある理由を一文で"}]`;

const RECALL_PROMPT = `以下は(A)本人が決めた内容と、(B)それを見ずに口頭で再現した内容。Bを採点する。
Markdownで下の構成。甘くしない。落ちた要素は漏らさず挙げる。

## 言えた要素
## 落ちた要素
(Aにあって、Bで触れられなかったもの)
## 粒度が落ちた箇所
(触れてはいるが抽象的になった箇所。Bの言い回しを引用して指摘)
## 判定
(見ずに人へ伝わる形になっていたか。次に直す一点を一文で)`;

// ---------- 小道具 ----------

const pad = n => String(n).padStart(2, "0");
function stamp(withDate) {
  const d = new Date();
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (!withDate) return hm;
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + hm;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    // 容量超過。古いセッションを落として1回だけ再試行する
    if (key === K_SESS) {
      const names = Object.keys(val).sort((a, b) => (val[a].mtime < val[b].mtime ? 1 : -1));
      names.slice(20).forEach(n => delete val[n]);
      try { localStorage.setItem(key, JSON.stringify(val)); return; } catch (e2) { /* fallthrough */ }
    }
    throw mkErr(507, "端末の保存領域がいっぱいです。設定からエクスポートして古いログを整理してください");
  }
}

function getKey() { return localStorage.getItem(K_KEY) || ""; }

function mkErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
function okRes(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function errRes(status, msg) {
  return { ok: false, status: status, json: async () => ({ detail: msg }), text: async () => msg };
}

// テーマ名はASCII限定にできない。パス区切りと危険文字だけ潰す(server.py と同じ規則)
function stockName(topic) {
  return String(topic || "").trim().replace(/[\\/:*?"<>|.\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

// ---------- Groq ----------

async function groqChat(messages, maxTokens, temperature, label) {
  const key = getKey();
  if (!key) throw mkErr(500, "Groq APIキーが未設定です（右上の「設定」から入力してください）");
  let res;
  try {
    res = await fetch(GROQ + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: CHAT_MODEL, messages: messages, max_tokens: maxTokens, temperature: temperature }),
    });
  } catch (e) {
    throw mkErr(502, "Groq " + label + "失敗: 通信できません");
  }
  if (!res.ok) throw mkErr(502, "Groq " + label + "失敗: " + (await res.text()).slice(0, 300));
  const j = await res.json();
  return ((j.choices && j.choices[0].message.content) || "").trim();
}

async function groqSTT(blob, filename) {
  const key = getKey();
  if (!key) throw mkErr(500, "Groq APIキーが未設定です（右上の「設定」から入力してください）");
  const fd = new FormData();
  fd.append("file", blob, filename || "utter.wav");
  fd.append("model", STT_MODEL);
  fd.append("language", "ja");
  fd.append("temperature", "0");
  fd.append("response_format", "json");
  let res;
  try {
    res = await fetch(GROQ + "/audio/transcriptions", {
      method: "POST", headers: { "Authorization": "Bearer " + key }, body: fd,
    });
  } catch (e) {
    throw mkErr(502, "Groq STT失敗: 通信できません");
  }
  if (!res.ok) throw mkErr(502, "Groq STT失敗: " + (await res.text()).slice(0, 300));
  const j = await res.json();
  return (j.text || "").trim();
}

// ---------- セッション / ストック / テーマ ----------

const STATUS_ORDER = { new: 0, diverged: 1, fixed: 2, tested: 3 };

function loadTopicsRaw() { return loadJSON(K_TOPICS, []); }
function saveTopicsRaw(items) { saveJSON(K_TOPICS, items); }

// 進捗は後戻りさせない。未登録テーマならその場で一覧に加える
function bumpStatus(name, status) {
  name = String(name || "").trim();
  if (!name) return;
  const items = loadTopicsRaw();
  for (const it of items) {
    if (it.name === name) {
      if ((STATUS_ORDER[status] || 0) > (STATUS_ORDER[it.status] || 0)) {
        it.status = status;
        saveTopicsRaw(items);
      }
      return;
    }
  }
  items.push({ name: name, opener: "", status: status, source: "manual", parent: "", added: stamp(true) });
  saveTopicsRaw(items);
}

function sessionBody(id) {
  const all = loadJSON(K_SESS, {});
  const s = all[id];
  if (!s) throw mkErr(404, "そのセッションのログがない");
  return s.body;
}

// ---------- ルーター ----------

async function api(path, opts) {
  opts = opts || {};
  const method = (opts.method || "GET").toUpperCase();
  let b = {};
  if (typeof opts.body === "string") {
    try { b = JSON.parse(opts.body); } catch (e) { b = {}; }
  }
  try {
    const res = okRes(await route(path, method, b, opts));
    // 書き込みがあったら、少し落ち着いてからPCへ送る（会話中は発言ごとにログが増えるので間を置く）
    if (method === "POST" && path !== "api/chat" && path !== "api/transcribe") scheduleSync();
    return res;
  } catch (e) {
    return errRes(e.status || 500, e.message || String(e));
  }
}

async function route(path, method, b, opts) {
  // --- 文字起こし ---
  if (path === "api/transcribe") {
    const blob = opts.body.get("audio");
    if (!blob || blob.size < 2000) return { text: "" };
    return { text: await groqSTT(blob, blob.name) };
  }

  // --- 返答 ---
  if (path === "api/chat") {
    const topic = String(b.topic || "").trim();
    const sys = (b.phase === "diverge" && topic)
      ? DIVERGE_PROMPT.replace("{topic}", topic.slice(0, 80))
      : SYSTEM_PROMPT;
    const msgs = [{ role: "system", content: sys }];
    (b.messages || []).slice(-16).forEach(m => {
      msgs.push({ role: m.role === "ai" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) });
    });
    return { reply: await groqChat(msgs, 300, 0.7, "chat") };
  }

  // --- ログ追記 ---
  if (path === "api/log") {
    const all = loadJSON(K_SESS, {});
    const id = b.session_id;
    if (!all[id]) all[id] = { mtime: stamp(true), body: "# 壁打ちログ " + stamp(true) + "\n\n" };
    const who = b.role === "ai" ? "AI" : "自分";
    all[id].body += "- **" + who + "** (" + stamp() + ") " + b.text + "\n";
    all[id].mtime = stamp(true);
    saveJSON(K_SESS, all);
    return { ok: true };
  }

  // --- まとめ ---
  if (path === "api/summary") {
    const all = loadJSON(K_SESS, {});
    const s = all[b.session_id];
    if (!s) throw mkErr(404, "ログがまだない");
    const md = await groqChat([
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: s.body.slice(-24000) },
    ], 1500, 0.3, "summary");
    s.body += "\n---\n\n# まとめ (" + stamp() + ")\n\n" + md + "\n";
    s.mtime = stamp(true);
    saveJSON(K_SESS, all);
    return { summary: md, file: "(この端末に保存)" };
  }

  // --- セッション一覧 / 本文 ---
  if (path === "api/sessions") {
    const all = loadJSON(K_SESS, {});
    const items = Object.keys(all)
      .map(n => ({ name: n, mtime: all[n].mtime }))
      .sort((x, y) => (x.mtime < y.mtime ? 1 : -1))
      .slice(0, 30);
    return { sessions: items };
  }
  if (path.startsWith("api/sessions/")) {
    return { body: sessionBody(decodeURIComponent(path.slice("api/sessions/".length))) };
  }

  // --- 整理する ---
  if (path === "api/structure") {
    const topic = String(b.topic || "").trim();
    const md = await groqChat([
      { role: "system", content: STRUCTURE_PROMPT.replace("{topic}", topic.slice(0, 80)) },
      { role: "user", content: sessionBody(b.session_id).slice(-24000) },
    ], 1800, 0.3, "structure");
    bumpStatus(topic, "diverged");
    return { md: md };
  }

  // --- テーマ一覧 ---
  if (path === "api/topics" && method === "GET") {
    // 確定/テスト済はストックの実体から拾い直すので、手で消しても表示が狂わない
    const items = loadTopicsRaw();
    const stocks = loadJSON(K_STOCK, {});
    let changed = false;
    items.forEach(it => {
      const s = stocks[stockName(it.name)];
      if (!s) return;
      const st = s.body.indexOf("## 試した記録") >= 0 ? "tested" : "fixed";
      if ((STATUS_ORDER[st] || 0) > (STATUS_ORDER[it.status] || 0)) { it.status = st; changed = true; }
    });
    if (changed) saveTopicsRaw(items);
    return { topics: items };
  }
  if (path === "api/topics" && method === "POST") {
    const name = String(b.name || "").trim().slice(0, 40);
    if (!name) throw mkErr(400, "テーマ名が空です");
    const items = loadTopicsRaw();
    if (items.some(it => it.name === name)) return { ok: true, dup: true };
    items.push({
      name: name, opener: String(b.opener || "").trim().slice(0, 120), status: "new",
      source: b.source || "manual", parent: String(b.parent || "").trim().slice(0, 40), added: stamp(true),
    });
    saveTopicsRaw(items);
    return { ok: true, dup: false };
  }
  if (path.startsWith("api/topics/") && method === "DELETE") {
    // 一覧から外すだけ。確定済みのストックには触らない
    const name = decodeURIComponent(path.slice("api/topics/".length));
    const items = loadTopicsRaw();
    const left = items.filter(it => it.name !== name);
    saveTopicsRaw(left);
    return { ok: true, removed: items.length - left.length };
  }

  // --- 派生テーマの抽出 ---
  if (path === "api/spawn") {
    const existing = loadTopicsRaw().map(it => it.name);
    const raw = await groqChat([
      {
        role: "system", content: SPAWN_PROMPT
          .replace("{topic}", String(b.topic || "").trim().slice(0, 80) || "(未設定)")
          .replace("{existing}", existing.join("、").slice(0, 600)),
      },
      { role: "user", content: sessionBody(b.session_id).slice(-16000) },
    ], 800, 0.4, "spawn");
    const m = raw.match(/\[[\s\S]*\]/);
    let cands = [];
    try { cands = m ? JSON.parse(m[0]) : []; } catch (e) { cands = []; }
    const out = [];
    cands.forEach(c => {
      if (!c || typeof c !== "object") return;
      const n = String(c.name || "").trim().slice(0, 40);
      if (n && existing.indexOf(n) < 0 && !out.some(o => o.name === n)) {
        out.push({
          name: n,
          opener: String(c.opener || "").trim().slice(0, 120),
          why: String(c.why || "").trim().slice(0, 120),
        });
      }
    });
    return { candidates: out.slice(0, 3) };
  }

  // --- ストック(決めた1枚) ---
  if (path === "api/stocks" && method === "GET") {
    const all = loadJSON(K_STOCK, {});
    const items = Object.keys(all)
      .map(n => ({ name: n, mtime: all[n].mtime }))
      .sort((x, y) => (x.mtime < y.mtime ? 1 : -1));
    return { stocks: items };
  }
  if (path.startsWith("api/stocks/") && method === "GET") {
    const safe = stockName(decodeURIComponent(path.slice("api/stocks/".length)));
    const all = loadJSON(K_STOCK, {});
    if (!safe || !all[safe]) throw mkErr(404, "まだ確定していないテーマ");
    return { body: all[safe].body };
  }
  if (path === "api/stocks" && method === "POST") {
    if (!String(b.body || "").trim()) throw mkErr(400, "本文が空です");
    const safe = stockName(b.topic);
    if (!safe) throw mkErr(400, "テーマ名が空です");
    const all = loadJSON(K_STOCK, {});
    const header = "# " + String(b.topic).trim() + "\n\n最終更新: " + stamp(true) + "\n\n";
    all[safe] = { mtime: stamp(true), body: header + String(b.body).trim() + "\n" };
    saveJSON(K_STOCK, all);
    bumpStatus(String(b.topic).trim(), "fixed");
    return { ok: true, file: "(この端末に保存)" };
  }

  // --- 試す(採点) ---
  if (path === "api/recall") {
    const safe = stockName(b.topic);
    const all = loadJSON(K_STOCK, {});
    if (!safe || !all[safe]) throw mkErr(404, "先に「決める」で保存してください");
    if (!String(b.spoken || "").trim()) throw mkErr(400, "口頭再現がまだ空です");
    const body = "# (A) 確定ストック\n\n" + all[safe].body.slice(0, 12000)
      + "\n\n# (B) 口頭再現\n\n" + String(b.spoken).slice(0, 8000);
    const md = await groqChat([
      { role: "system", content: RECALL_PROMPT },
      { role: "user", content: body },
    ], 1400, 0.2, "recall");
    all[safe].body += "\n---\n\n## 試した記録 (" + stamp(true) + ")\n\n" + md + "\n";
    all[safe].mtime = stamp(true);
    saveJSON(K_STOCK, all);
    bumpStatus(String(b.topic).trim(), "tested");
    return { result: md };
  }

  throw mkErr(404, "unknown endpoint: " + path);
}

// ---------- PCとの同期（型C：PCが起きていれば自動で突き合わせる） ----------
// PCが落ちていても、この端末だけで全部動く。PCが起きていれば PC版(server.py の /api/sync)へ
// ログ・ストック・テーマを送り、PC側にしか無いものを受け取る。PC側に入ったログは土曜のプロフィール更新案に載る。
// PCのアドレスは公開コードに書かない。設定で端末ごとに入れる。

const K_PC = "kabeuchi_pc_url";
const K_PC_LAST = "kabeuchi_pc_last";
let syncTimer = null, syncing = false;

function pcUrl() {
  let u = "";
  try { u = (localStorage.getItem(K_PC) || "").trim(); } catch (e) {}
  if (!u) return "";
  return u.endsWith("/") ? u : u + "/";
}
function setPcState(st) {
  const b = document.getElementById("btn-settings");
  if (b) b.textContent = "設定" + ({ ok: "・PC✓", offline: "・PC×", busy: "・PC…" }[st] || "");
}
function scheduleSync() {
  if (!pcUrl()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncWithPC, 20000);
}
function mergeByMtime(key, inc) {
  const cur = loadJSON(key, {});
  let n = 0;
  Object.keys(inc || {}).forEach(k => {
    if (!cur[k] || (cur[k].mtime || "") < (inc[k].mtime || "")) { cur[k] = inc[k]; n++; }
  });
  if (n) saveJSON(key, cur);
  return n;
}
async function syncWithPC() {
  const base = pcUrl();
  if (!base) { setPcState("off"); return { ok: false, error: "PCのアドレスが未設定" }; }
  if (syncing) return { ok: false, error: "同期中" };
  syncing = true;
  setPcState("busy");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);   // PCが落ちているとTailscaleの応答待ちが長い
    const r = await fetch(base + "api/sync", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ sessions: loadJSON(K_SESS, {}), stocks: loadJSON(K_STOCK, {}), topics: loadTopicsRaw() }),
    });
    clearTimeout(t);
    if (!r.ok) throw new Error("PCが応答しません (" + r.status + ")");
    const d = await r.json();
    const got = mergeByMtime(K_SESS, d.sessions) + mergeByMtime(K_STOCK, d.stocks);
    if (Array.isArray(d.topics)) saveTopicsRaw(d.topics);   // PC側で和集合にしたもの
    try { localStorage.setItem(K_PC_LAST, stamp(true)); } catch (e) {}
    setPcState("ok");
    return { ok: true, sent: (d.written.sessions || 0) + (d.written.stocks || 0), got };
  } catch (e) {
    setPcState("offline");
    return { ok: false, error: e.name === "AbortError" ? "PCに届きません（落ちている？）" : (e.message || String(e)) };
  } finally {
    syncing = false;
  }
}

// ---------- 設定 / データ持ち運び ----------

function exportData() {
  const data = {
    app: "kabeuchi",
    exported: stamp(true),
    groq_key: getKey(),
    topics: loadTopicsRaw(),
    sessions: loadJSON(K_SESS, {}),
    stocks: loadJSON(K_STOCK, {}),
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = "kabeuchi_backup_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(data, msgEl) {
  if (!data || data.app !== "kabeuchi") throw new Error("形式が違います");
  // 追加インポート。同名のテーマ/ログは既存を残す
  if (Array.isArray(data.topics)) {
    const items = loadTopicsRaw();
    data.topics.forEach(t => {
      if (t && t.name && !items.some(x => x.name === t.name)) items.push(t);
    });
    saveTopicsRaw(items);
  }
  ["sessions", "stocks"].forEach(kind => {
    const key = kind === "sessions" ? K_SESS : K_STOCK;
    const cur = loadJSON(key, {});
    const inc = data[kind] || {};
    Object.keys(inc).forEach(n => { if (!cur[n]) cur[n] = inc[n]; });
    saveJSON(key, cur);
  });
  if (data.groq_key && !getKey()) localStorage.setItem(K_KEY, data.groq_key);
  const nt = (data.topics || []).length;
  const ns = Object.keys(data.sessions || {}).length;
  const nk = Object.keys(data.stocks || {}).length;
  msgEl.textContent = "インポートしました（テーマ" + nt + " / ログ" + ns + " / ストック" + nk + "）";
}

function openSettings() {
  const ov = document.getElementById("modal-overlay");
  const mb = document.getElementById("modal-body");
  document.getElementById("modal-title").textContent = "設定 / データ";
  mb.style.whiteSpace = "normal";
  mb.innerHTML = ""
    + '<div style="font-size:12px;line-height:1.9">'
    + '<div style="margin-bottom:6px">Groq APIキー（この端末にだけ保存されます）</div>'
    + '<input id="set-key" type="password" placeholder="gsk_..." '
    + 'style="width:100%;padding:9px 10px;font-size:13px;border-radius:6px;'
    + 'border:1px solid var(--border);background:var(--surface);color:var(--text)">'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button class="small-btn" id="set-save">保存</button>'
    + '<button class="small-btn" id="set-export">エクスポート</button>'
    + '<button class="small-btn" id="set-import">インポート</button>'
    + '</div>'
    + '<input id="set-file" type="file" accept="application/json,.json" style="display:none">'
    + '<div id="set-msg" style="margin-top:10px;color:var(--muted)"></div>'
    + '<div style="margin:16px 0 6px">PCのアドレス（PC版と同期するとき）</div>'
    + '<input id="set-pc" type="url" inputmode="url" placeholder="https://…/kabeuchi/" '
    + 'style="width:100%;padding:9px 10px;font-size:13px;border-radius:6px;'
    + 'border:1px solid var(--border);background:var(--surface);color:var(--text)">'
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<button class="small-btn" id="set-pc-save">保存して同期</button>'
    + '<button class="small-btn" id="set-pc-sync">今すぐ同期</button>'
    + '</div>'
    + '<div id="set-pc-msg" style="margin-top:8px;color:var(--muted)"></div>'
    + '<div style="margin-top:14px;color:var(--muted);font-size:11px;line-height:1.8">'
    + 'ログ・テーマ・ストックはこの端末に保存され、PCが落ちていても使えます。'
    + 'PCのアドレスを入れておくと、PCが起きているときに自動でPC版と突き合わせます'
    + '（PCに入ったログは土曜のプロフィール更新案に載ります）。</div>'
    + '</div>';
  ov.classList.add("open");

  const msg = document.getElementById("set-msg");
  document.getElementById("set-key").value = getKey();
  document.getElementById("set-save").onclick = () => {
    const v = document.getElementById("set-key").value.trim();
    if (v) localStorage.setItem(K_KEY, v); else localStorage.removeItem(K_KEY);
    msg.textContent = v ? "保存しました" : "キーを消しました";
  };
  const pcMsg = document.getElementById("set-pc-msg");
  const showLast = () => {
    let last = "";
    try { last = localStorage.getItem(K_PC_LAST) || ""; } catch (e) {}
    pcMsg.textContent = pcUrl() ? ("最後に同期: " + (last || "まだ")) : "未設定（この端末だけで使う）";
  };
  const runSync = async () => {
    pcMsg.textContent = "同期中…";
    const r = await syncWithPC();
    if (r.ok) pcMsg.textContent = "同期しました（PCへ " + r.sent + "件 / PCから " + r.got + "件）";
    else pcMsg.textContent = "同期できません: " + r.error;
  };
  document.getElementById("set-pc").value = pcUrl();
  showLast();
  document.getElementById("set-pc-save").onclick = () => {
    const v = document.getElementById("set-pc").value.trim();
    try { if (v) localStorage.setItem(K_PC, v); else localStorage.removeItem(K_PC); } catch (e) {}
    if (v) runSync(); else { setPcState("off"); showLast(); }
  };
  document.getElementById("set-pc-sync").onclick = runSync;
  document.getElementById("set-export").onclick = exportData;
  document.getElementById("set-import").onclick = () => document.getElementById("set-file").click();
  document.getElementById("set-file").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { importData(JSON.parse(await f.text()), msg); }
    catch (err) { msg.textContent = "インポート失敗: " + (err.message || err); }
    e.target.value = "";
  });
}

window.addEventListener("load", () => {
  const actions = document.querySelector(".header-actions");
  if (actions) {
    const btn = document.createElement("button");
    btn.className = "small-btn";
    btn.id = "btn-settings";
    btn.textContent = "設定";
    btn.onclick = openSettings;
    actions.insertBefore(btn, actions.firstChild);
  }
  if (!getKey()) setTimeout(openSettings, 300);   // キー未設定では何も動かないので最初に出す
  // 開いたとき・画面に戻ってきたとき・開きっぱなしなら数分おきに、PCと突き合わせる
  syncWithPC();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncWithPC(); });
  setInterval(() => { if (document.visibilityState === "visible") syncWithPC(); }, 180000);
});
