"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const UA_LX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HOST_VERSION = "2.0.0";
const DEFAULT_TIMEOUT = 15e3;
const ACTION_ALIASES = {
  search: ["search", "musicSearch"],
  musicUrl: ["musicUrl", "getMusicUrl"],
  lyric: ["lyric", "getLyric"],
  pic: ["pic", "getPic"]
};
function makeRespBody(text, parsed) {
  if (parsed == null || typeof parsed !== "object") return text;
  const s = new String(text);
  return new Proxy(s, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => text;
      if (prop === "length") return text.length;
      if (typeof prop === "string" && prop in parsed) return parsed[prop];
      const r = Reflect.get(t, prop, t);
      return typeof r === "function" ? r.bind(t) : r;
    }
  });
}
function makeRequest(log) {
  return function request(url, options, callback) {
    let reqUrl = url, opts = options, cb = callback;
    if (typeof url === "object" && url !== null) {
      opts = url;
      reqUrl = url.url;
      cb = options;
    }
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    if (typeof cb !== "function") cb = () => {
    };
    if (!opts || typeof opts !== "object") opts = {};
    const method = String(opts.method || "GET").toUpperCase();
    const headers = Object.assign({ "User-Agent": UA_LX }, opts.headers || {});
    let body;
    if (opts.body != null) {
      if (Buffer.isBuffer(opts.body)) body = opts.body;
      else if (typeof opts.body === "object") {
        body = JSON.stringify(opts.body);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      } else body = String(opts.body);
    } else if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (opts.formData) {
      body = new URLSearchParams(opts.formData).toString();
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (opts.json != null && typeof opts.json !== "boolean") {
      body = JSON.stringify(opts.json);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    const timeout = opts.timeout || DEFAULT_TIMEOUT;
    const responseType = opts.responseType || "text";
    const maxRedirects = opts.maxRedirects != null ? opts.maxRedirects : 10;
    const dbg = process.env.LX_DEBUG ? (m, s) => console.log(`    [req${m}] ${String(s).slice(0, 300)}`) : () => {
    };
    dbg(">", `${method} ${reqUrl} ${body ? "body=" + String(body).slice(0, 200) : ""}`);
    fetch(reqUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? void 0 : body,
      redirect: maxRedirects > 0 ? "follow" : "manual",
      signal: AbortSignal.timeout(timeout)
    }).then(async (r) => {
      const rh = {};
      r.headers.forEach((v, k) => {
        rh[k] = v;
      });
      const respText = await r.text();
      let parsed = null;
      const ct = (rh["content-type"] || "").toLowerCase();
      if (responseType === "json" || ct.includes("json") || /^[\s]*[{\[]/.test(respText)) {
        try {
          parsed = JSON.parse(respText);
        } catch (_) {
        }
      }
      dbg("<", `${r.status} ${String(respText).slice(0, 240)}`);
      const bodyOut = responseType === "buffer" || responseType === "arraybuffer" ? Buffer.from(respText, "utf8") : makeRespBody(respText, parsed);
      cb(null, {
        statusCode: r.status,
        status: r.status,
        statusMessage: r.statusText,
        headers: rh,
        body: bodyOut
      });
    }).catch((err) => cb(err));
  };
}
function wrapPem(key) {
  if (key.includes("-----")) return key;
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const wrapped = b64.replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PUBLIC KEY-----
${wrapped}
-----END PUBLIC KEY-----`;
}
function makeUtils() {
  return {
    buffer: {
      from: (data, encoding) => Buffer.from(data, encoding || "utf8"),
      bufToString: (buf, format) => format === "hex" ? Buffer.from(buf).toString("hex") : format === "base64" ? Buffer.from(buf).toString("base64") : format === "binary" ? Buffer.from(buf).toString("binary") : Buffer.from(buf).toString("utf8")
    },
    crypto: {
      md5: (str, upper) => {
        const h = crypto.createHash("md5").update(String(str), "utf8").digest("hex");
        return upper ? h.toUpperCase() : h;
      },
      sha1: (str) => crypto.createHash("sha1").update(String(str), "utf8").digest("hex"),
      sha256: (str) => crypto.createHash("sha256").update(String(str), "utf8").digest("hex"),
      randomBytes: (len, type) => crypto.randomBytes(len).toString(type || "hex"),
      aesEncrypt: (data, mode, key, iv) => {
        const c = crypto.createCipheriv(String(mode).toLowerCase(), Buffer.from(key), iv != null ? Buffer.from(iv) : null);
        return Buffer.concat([c.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data))), c.final()]);
      },
      aesDecrypt: (data, mode, key, iv) => {
        const d = crypto.createDecipheriv(String(mode).toLowerCase(), Buffer.from(key), iv != null ? Buffer.from(iv) : null);
        return Buffer.concat([d.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data), "base64")), d.final()]);
      },
      aesEn: function(data, mode, key, iv) {
        return this.aesEncrypt(data, mode, key, iv);
      },
      aesDe: function(data, mode, key, iv) {
        return this.aesDecrypt(data, mode, key, iv);
      },
      rsaEncrypt: (data, key, padding) => crypto.publicEncrypt(
        { key: wrapPem(String(key)), padding: padding != null ? padding : crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(String(data))
      )
    },
    zlib: {
      inflate: (buf) => zlib.inflateSync(Buffer.from(buf)),
      gunzip: (buf) => zlib.gunzipSync(Buffer.from(buf)),
      deflate: (buf) => zlib.deflateSync(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf))),
      gzip: (buf) => zlib.gzipSync(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)))
    }
  };
}
function loadScript(file, log = () => {
}) {
  const code = fs.readFileSync(file, "utf8");
  const meta = {};
  const head = code.slice(0, 1500);
  for (const k of ["name", "description", "version", "author", "homepage"]) {
    const m = head.match(new RegExp(`@${k}\\s+(.+)`));
    if (m) meta[k] = m[1].trim();
  }
  const state = { handler: null, inited: null, alerts: [] };
  let initedWaiters = [];
  const waitInited = (ms) => new Promise((resolve, reject) => {
    if (state.inited) return resolve(state.inited);
    const t = setTimeout(() => reject(new Error("\u811A\u672C\u672A\u5728\u9650\u65F6\u5185\u5B8C\u6210\u521D\u59CB\u5316")), ms);
    initedWaiters.push((d) => {
      clearTimeout(t);
      resolve(d);
    });
  });
  const lx = {
    EVENT_NAMES: { request: "request", inited: "inited", updateAlert: "updateAlert" },
    version: HOST_VERSION,
    env: "desktop",
    on(name, handler) {
      if (name === "request") state.handler = handler;
    },
    send(name, data) {
      if (name === "inited") {
        state.inited = data;
        initedWaiters.forEach((w) => w(data));
        initedWaiters = [];
        log(`inited: status=${data && data.status} sources=${data && data.sources ? Object.keys(data.sources).join(",") : "?"}`);
      } else if (name === "updateAlert") {
        state.alerts.push(data);
        log(`updateAlert: ${JSON.stringify(data).slice(0, 160)}`);
      }
    },
    request: makeRequest(log),
    currentScriptInfo: {
      name: path.basename(file || "source.js", ".js"),
      description: meta.description || "",
      version: meta.version || "0.0.0",
      author: meta.author || "",
      homepage: meta.homepage || ""
    },
    app: { version: "0.0.0", isPackaged: false, getName: () => "lx-music", on() {
    }, send() {
    } },
    utils: makeUtils()
  };
  const ctx = {
    console: {
      log: (...a) => log(`[script] ${a.map((x) => typeof x === "object" ? JSON.stringify(x).slice(0, 300) : String(x)).join(" ").slice(0, 300)}`),
      warn: (...a) => log(`[script-warn] ${a.map(String).join(" ").slice(0, 200)}`),
      error: (...a) => log(`[script-err] ${a.map(String).join(" ").slice(0, 300)}`),
      info: (...a) => {
      },
      debug: () => {
      },
      group: () => {
      },
      groupEnd: () => {
      },
      groupCollapsed: () => {
      },
      table: () => {
      },
      dir: () => {
      },
      assert: () => {
      },
      trace: () => {
      },
      count: () => {
      },
      countReset: () => {
      },
      time: () => {
      },
      timeEnd: () => {
      },
      timeLog: () => {
      },
      clear: () => {
      },
      profile: () => {
      },
      profileEnd: () => {
      }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    JSON,
    Math,
    Date,
    Promise,
    RegExp,
    String,
    Number,
    Array,
    Object,
    Map,
    Set,
    Proxy,
    Symbol,
    fetch: void 0,
    require: void 0,
    process: void 0,
    global: void 0,
    module: void 0,
    exports: void 0
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.lx = lx;
  vm.createContext(ctx);
  try {
    vm.runInContext(code, ctx, { filename: path.basename(file), timeout: 15e3 });
  } catch (e) {
    return { ok: false, meta, error: `\u811A\u672C\u52A0\u8F7D\u5931\u8D25: ${e.message}` };
  }
  return { ok: true, meta, state, waitInited };
}
async function dispatchAction(engine, action, source, info, timeoutMs = 12e3) {
  const aliases = ACTION_ALIASES[action] || [action];
  let lastErr = "";
  for (const name of aliases) {
    try {
      const r = await Promise.race([
        Promise.resolve(engine.state.handler({ source, action: name, info })),
        new Promise((_, rej) => setTimeout(() => rej(new Error("\u52A8\u4F5C\u8D85\u65F6")), timeoutMs))
      ]);
      if (r !== void 0 && r !== null) return { ok: true, action: name, result: r };
      lastErr = `${name}: \u7A7A\u54CD\u5E94`;
    } catch (e) {
      lastErr = `${name}: ${e.message}`;
      if (!/不支持|未知|invalid action|not (support|found)/i.test(e.message)) throw e;
    }
  }
  throw new Error(lastErr || "\u65E0\u7ED3\u679C");
}
const LX_QUALITY = {
  master: ["master", "flac24bit", "flac"],
  atmos_plus: ["atmos_plus", "atmos", "flac"],
  atmos: ["atmos", "flac"],
  hires: ["hires", "flac"],
  lossless: ["flac", "320k", "128k"],
  high: ["320k", "128k"],
  standard: ["128k"]
};
async function resolveMusicUrl(engine, source, quality, musicInfo) {
  const types = Array.isArray(quality) ? quality : LX_QUALITY[quality] || LX_QUALITY.lossless;
  let lastErr = "";
  for (const type of types) {
    try {
      const info = { type, musicInfo };
      const r = await dispatchAction(engine, "musicUrl", source, info, 12e3);
      const res = r.result;
      if (typeof res === "string" && /^https?:/i.test(res)) return { url: res, type, via: r.action };
      if (res && typeof res.url === "string" && /^https?:/i.test(res.url)) return { url: res.url, type, via: r.action };
      if (res && typeof res === "string" && res) return { url: res, type, via: r.action };
      lastErr = `${type}: \u7A7A/\u62D2\u7EDD(${r.action})`;
    } catch (e) {
      lastErr = `${type}: ${e.message}`;
    }
  }
  throw new Error(lastErr || "\u65E0\u7ED3\u679C");
}
async function resolveSearch(engine, source, keyword, limit = 20, timeoutMs = 9e3) {
  const r = await dispatchAction(engine, "search", source, { keyword, limit }, timeoutMs);
  const res = r.result;
  const items = Array.isArray(res) ? res : res && Array.isArray(res.list) ? res.list : [];
  return { items, via: r.action };
}
async function resolveLyric(engine, source, musicInfo) {
  const r = await dispatchAction(engine, "lyric", source, { musicInfo }, 12e3);
  return r.result;
}
async function resolvePic(engine, source, musicInfo) {
  const r = await dispatchAction(engine, "pic", source, { musicInfo }, 12e3);
  return r.result;
}
function loadDir(dir, log = () => {
}) {
  const engines = [];
  if (!fs.existsSync(dir)) return engines;
  for (const f of fs.readdirSync(dir).filter((f2) => f2.toLowerCase().endsWith(".js"))) {
    const file = path.join(dir, f);
    try {
      const engine = loadScript(file, (m) => log(`[${f}] ${m}`));
      if (!engine.ok) {
        engines.push({ ok: false, file: f, meta: engine.meta, error: engine.error });
        continue;
      }
      engines.push({ ok: true, file: f, meta: engine.meta, state: engine.state, waitInited: engine.waitInited });
      log(`[${f}] loaded`);
    } catch (e) {
      engines.push({ ok: false, file: f, error: e.message });
    }
  }
  return engines;
}
async function initEngines(engines, timeoutMs = 8e3) {
  for (const e of engines) {
    if (!e.ok) continue;
    try {
      await e.waitInited(timeoutMs);
      e.sources = e.state.inited && e.state.inited.sources || {};
      e.openDevTools = false;
    } catch (err) {
      e.ok = false;
      e.error = err.message;
    }
  }
  return engines;
}
module.exports = {
  loadScript,
  loadDir,
  initEngines,
  resolveMusicUrl,
  resolveSearch,
  resolveLyric,
  resolvePic,
  dispatchAction,
  ACTION_ALIASES,
  LX_QUALITY
};
