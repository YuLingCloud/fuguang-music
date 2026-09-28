"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable, Transform } = require("stream");
const DIR = process.env.AUDIO_CACHE_DIR || "/tmp/fuguang-audio-cache";
const MAX_BYTES = 50 * 1024 * 1024 * 1024;
const PREFETCH_MAX = 3;
try {
  fs.mkdirSync(DIR, { recursive: true });
} catch (_) {
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const HOST_OK = /(^|\.)(music\.126\.net|qq\.com|kuwo\.cn|kugou\.com|kgimg\.com|migu\.cn)$/i;
const refFor = (h) => h.includes("126.net") ? "https://music.163.com/" : h.includes("qq.com") ? "https://y.qq.com/" : h.includes("kuwo.cn") ? "https://www.kuwo.cn/" : h.includes("kgimg.com") || h.includes("kugou.com") ? "https://www.kugou.com/" : h.includes("migu.cn") ? "https://music.migu.cn/" : "";
const active = new Map();
const prefetch = new Map();
const hashOf = (key) => crypto.createHash("sha1").update(String(key)).digest("hex");
const keyOf = (u) => {
  try {
    const p = new URL(u).pathname;
    const fname = decodeURIComponent(p.slice(p.lastIndexOf("/") + 1));
    if (fname && fname.length >= 16 && /\.[a-z0-9]{2,5}$/i.test(fname)) return fname;
  } catch (_) {
  }
  return String(u || "");
};
const binOf = (h) => path.join(DIR, h + ".bin");
const metaOf = (h) => path.join(DIR, h + ".meta");
const readMeta = (h) => {
  try {
    return JSON.parse(fs.readFileSync(metaOf(h), "utf8"));
  } catch (_) {
    return null;
  }
};
const writeMeta = (h, m) => {
  try {
    fs.writeFileSync(metaOf(h), JSON.stringify(m));
  } catch (_) {
  }
};
const haveBytes = (h) => {
  try {
    return fs.statSync(binOf(h)).size;
  } catch (_) {
    return 0;
  }
};
const isComplete = (h) => {
  const m = readMeta(h);
  return !!(m && m.total && haveBytes(h) >= m.total);
};
function trim(protect) {
  try {
    const items = fs.readdirSync(DIR).filter((f) => f.endsWith(".bin")).map((f) => {
      const st = fs.statSync(path.join(DIR, f));
      return { h: f.slice(0, -4), m: st.mtimeMs, size: st.size };
    });
    let total = items.reduce((a, b) => a + b.size, 0);
    if (total <= MAX_BYTES) return;
    items.sort((a, b) => a.m - b.m);
    let freed = 0;
    for (const it of items) {
      if (total <= MAX_BYTES * 0.8) break;
      if (it.h === protect || active.has(it.h) || prefetch.has(it.h)) continue;
      for (const f of [binOf(it.h), metaOf(it.h)]) {
        try {
          fs.unlinkSync(f);
        } catch (_) {
        }
      }
      total -= it.size;
      freed += it.size;
    }
    if (freed > 0) console.error("[v4] trim freed", Math.round(freed / 1048576) + "MB", "cache now", Math.round(total / 1048576) + "MB");
  } catch (_) {
  }
}
function parseRange(range, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || "");
  if (!m || m[1] === "" && m[2] === "") return null;
  let start = m[1] === "" ? null : parseInt(m[1], 10);
  let end = m[2] === "" ? null : parseInt(m[2], 10);
  if (total) {
    if (start === null) start = Math.max(0, total - (end !== null ? end + 1 : 0));
    if (end === null || end >= total) end = total - 1;
  }
  if (start === null || end !== null && start > end) return null;
  return { start, end };
}
function sendFileRange(res, file, start, end, total, ct, status) {
  const head = {
    "Content-Type": ct || "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store"
  };
  if (status === 206) {
    head["Content-Range"] = "bytes " + start + "-" + end + "/" + (total != null ? total : "*");
    head["Content-Length"] = String(end - start + 1);
  } else if (total != null) {
    head["Content-Length"] = String(total);
  }
  res.writeHead(status, head);
  fs.createReadStream(file, { start, end: end == null ? void 0 : end }).on("error", () => {
    try {
      res.end();
    } catch (_) {
    }
  }).pipe(res);
}
function skipLead(src, skip) {
  let left = skip;
  const t = new Transform({
    transform(chunk, _enc, cb) {
      if (left <= 0) return cb(null, chunk);
      if (chunk.length <= left) {
        left -= chunk.length;
        return cb();
      }
      const out = chunk.subarray(left);
      left = 0;
      cb(null, out);
    }
  });
  src.pipe(t);
  return t;
}
function startPrefetch(uStr, hash) {
  if (!uStr) return true;
  if (prefetch.has(hash) || active.has(hash) || isComplete(hash)) return true;
  let u;
  try {
    u = new URL(uStr);
  } catch (_) {
    return false;
  }
  if (!/^https?:$/.test(u.protocol) || !HOST_OK.test(u.hostname)) return false;
  while (prefetch.size >= PREFETCH_MAX) {
    const oldest = prefetch.keys().next().value;
    try {
      prefetch.get(oldest).ac.abort();
    } catch (_) {
    }
    prefetch.delete(oldest);
  }
  const ent = { ac: new AbortController(), retries: 0 };
  prefetch.set(hash, ent);
  console.error("[v4] prefetch start", hash.slice(0, 8), "have", haveBytes(hash));
  (async () => {
    try {
      const have0 = haveBytes(hash);
      const headers = { "User-Agent": UA, Referer: refFor(u.hostname) };
      if (have0 > 0) headers.Range = "bytes=" + have0 + "-";
      const up = await fetch(u, { headers, redirect: "follow", signal: ent.ac.signal });
      if (up.status !== 200 && up.status !== 206) {
        console.error("[v4] prefetch bad status", up.status, hash.slice(0, 8));
        return;
      }
      if (up.status === 206 && have0 > 0) {
        const cr = up.headers.get("content-range");
        const m2 = cr && /^bytes\s+(\d+)-/i.exec(cr);
        if (!m2 || parseInt(m2[1], 10) !== have0) {
          console.error("[v4] prefetch CR mismatch", hash.slice(0, 8), cr);
          return;
        }
      }
      const skip = up.status === 200 && have0 > 0 ? have0 : 0;
      if (!readMeta(hash)) {
        const cr = up.headers.get("content-range");
        const mm = cr && /\/(\d+)\s*$/.exec(cr);
        const t = mm ? parseInt(mm[1], 10) : parseInt(up.headers.get("content-length") || "0", 10) || null;
        writeMeta(hash, { total: t, ct: (up.headers.get("content-type") || "").toLowerCase() });
      }
      active.set(hash, true);
      await new Promise((resolve) => {
        const ws = fs.createWriteStream(binOf(hash), { flags: have0 > 0 ? "a" : "w" });
        let n = 0;
        ws.on("error", (e) => {
          console.error("[v4] prefetch ws error", e.message);
          try {
            ws.destroy();
          } catch (_) {
          }
          resolve();
        });
        let body = Readable.fromWeb(up.body);
        if (skip) body = skipLead(body, skip);
        body.on("data", (c) => {
          n += c.length;
          try {
            ws.write(c);
          } catch (_) {
          }
        });
        body.on("end", () => {
          try {
            ws.end();
          } catch (_) {
          }
        });
        body.on("error", () => {
          try {
            ws.end();
          } catch (_) {
          }
          resolve();
        });
        body.on("close", () => {
          try {
            ws.end();
          } catch (_) {
          }
        });
        ws.on("finish", () => {
          console.error("[v4] prefetch done", hash.slice(0, 8), Math.round(n / 1024) + "KB");
          resolve();
        });
      });
      const m = readMeta(hash);
      if (m) {
        const size = haveBytes(hash);
        if (!m.total && size) writeMeta(hash, Object.assign(m, { total: size }));
        else if (m.total && size >= m.total) writeMeta(hash, m);
      }
      trim(hash);
    } catch (e) {
      if (e && e.name !== "AbortError") console.error("[v4] prefetch error", hash.slice(0, 8), e.message);
    } finally {
      prefetch.delete(hash);
      active.delete(hash);
    }
  })();
  return true;
}
function followStream(res, file, hash, uStr, start, endPos, ct, startedHave) {
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  let pos = start;
  let retries = 0;
  let wroteHead = false;
  const writeHeadOnce = () => {
    if (wroteHead) return;
    wroteHead = true;
    const total = (readMeta(hash) || {}).total || null;
    const head = {
      "Content-Type": ct || "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store"
    };
    const end = endPos != null ? endPos : total != null ? total - 1 : null;
    head["Content-Range"] = "bytes " + start + "-" + (end != null ? end : "*") + "/" + (total != null ? total : "*");
    if (end != null) head["Content-Length"] = String(end - start + 1);
    res.writeHead(206, head);
  };
  const tick = () => {
    if (closed) return;
    const size = haveBytes(hash);
    const target = endPos != null ? endPos : isComplete(hash) ? size - 1 : null;
    if (pos < size && (target == null || pos <= target)) {
      const stop = target != null ? Math.min(size - 1, target) : size - 1;
      if (stop >= pos) {
        writeHeadOnce();
        const rs = fs.createReadStream(file, { start: pos, end: stop });
        rs.on("data", () => {
        });
        rs.pipe(res, { end: false });
        rs.on("end", () => {
          pos = stop + 1;
          next();
        });
        rs.on("error", () => next());
        return;
      }
    }
    next();
  };
  const next = () => {
    if (closed) return;
    const size = haveBytes(hash);
    const complete = isComplete(hash);
    const reached = endPos != null ? pos > endPos : complete && pos >= size;
    if (reached) {
      if (wroteHead) {
        try {
          res.end();
        } catch (_) {
        }
      }
      return;
    }
    if (!prefetch.has(hash) && !active.has(hash) && !isComplete(hash)) {
      if (retries < 2) {
        retries++;
        console.error("[v4] follow re-prefetch", hash.slice(0, 8), "try", retries);
        startPrefetch(uStr, hash);
        setTimeout(tick, 400);
        return;
      }
      console.error("[v4] follow giveup", hash.slice(0, 8), "pos", pos);
      if (wroteHead) {
        try {
          res.end();
        } catch (_) {
        }
      } else {
        try {
          res.writeHead(502);
          res.end("prefetch fail");
        } catch (_) {
        }
      }
      return;
    }
    setTimeout(tick, 150);
  };
  tick();
}
async function streamProxy(req, res, raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (_) {
    res.writeHead(400);
    res.end("bad url");
    return;
  }
  if (!/^https?:$/.test(u.protocol)) {
    res.writeHead(400);
    res.end("bad proto");
    return;
  }
  if (!HOST_OK.test(u.hostname)) {
    res.writeHead(403);
    res.end("host not allowed");
    return;
  }
  const hash = hashOf(keyOf(raw));
  const file = binOf(hash);
  const meta = readMeta(hash);
  const total = meta && meta.total || null;
  const have = haveBytes(hash);
  const done = isComplete(hash);
  const rng = parseRange(req.headers.range, total);
  const start = rng ? rng.start : 0;
  const end = rng ? rng.end : total != null ? total - 1 : null;
  const ct = meta && meta.ct || "";
  startPrefetch(raw, hash);
  console.error("[v4] enter", hash.slice(0, 8), "have", have, "done", done, "rng", req.headers.range || "none", "total", total, "key", keyOf(raw).slice(0, 24));
  if (done && start === 0) {
    console.error("[v4] path A", hash.slice(0, 8));
    sendFileRange(res, file, 0, total - 1, total, ct, rng ? 206 : 200);
    return;
  }
  if (have > start && end !== null && end < have) {
    console.error("[v4] path B", hash.slice(0, 8));
    sendFileRange(res, file, start, end, total, ct, 206);
    return;
  }
  if (start <= have && !done) {
    console.error("[v4] path C-follow", hash.slice(0, 8), "have", have, "start", start);
    followStream(res, file, hash, raw, start, end, ct, have);
    return;
  }
  console.error("[v4] path D direct", hash.slice(0, 8), "start", start, "have", have);
  const baseHeaders = { "User-Agent": UA, Referer: refFor(u.hostname) };
  let upHeaders = Object.assign({}, baseHeaders);
  if (rng) upHeaders.Range = "bytes=" + start + "-" + (end != null ? end : "");
  let up;
  try {
    up = await fetch(u, { headers: upHeaders, redirect: "follow" });
  } catch (_) {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("upstream fail");
    }
    return;
  }
  console.error("[v4] D upstream", up.status, "CR:", up.headers.get("content-range"));
  const outHead = {
    "Content-Type": up.headers.get("content-type") || ct || "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store"
  };
  const cr2 = up.headers.get("content-range");
  const cl2 = up.headers.get("content-length");
  if (up.status === 206 && cr2) outHead["Content-Range"] = cr2;
  if (cl2) outHead["Content-Length"] = cl2;
  res.writeHead(up.status, outHead);
  if (!up.body) {
    res.end();
    return;
  }
  Readable.fromWeb(up.body).on("error", () => {
    try {
      res.end();
    } catch (_) {
    }
  }).pipe(res, { end: true });
}
function dropAudioCacheByU(raw) {
  const h = hashOf(keyOf(raw));
  let n = 0;
  if (prefetch.has(h)) {
    try {
      prefetch.get(h).ac.abort();
    } catch (_) {
    }
    prefetch.delete(h);
  }
  for (const f of [binOf(h), metaOf(h)]) {
    try {
      fs.unlinkSync(f);
      n++;
    } catch (_) {
    }
  }
  active.delete(h);
  return n;
}
trim();
setInterval(() => trim(), 5 * 60 * 1e3).unref();
module.exports = { streamProxy, dropAudioCacheByU };
