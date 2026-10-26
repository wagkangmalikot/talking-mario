// Mario voice relay — a Cloudflare Worker.
// The app sends text here; this worker asks Microsoft's Edge read-aloud service
// (the same one the Python edge-tts library uses) for the Diego voice and returns an MP3.
// It is also Mario's free brain: /chat answers with Cloudflare Workers AI (free daily allowance).
// Paste this whole file into a Cloudflare Worker and press Deploy.
// For the brain, add a Workers AI binding named AI (Settings > Bindings > Add > Workers AI).

const ALLOWED_ORIGINS = [
  'https://wagkangmalikot.github.io',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost'
];

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM = '143.0.3650.75';
const MAJOR = CHROMIUM.split('.')[0];
const WSS = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' + TOKEN;

const DEFAULTS = { voice: 'it-IT-DiegoNeural', rate: '+20%', pitch: '+50Hz' };

function cors(origin) {
  const ok = ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + ':'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase(); }
function randomHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }

// ---- Sec-MS-GEC v2 token (port of edge-tts 7.3.1 drm.py) ----
const M = 0xFFFFFFFFn;
const H0 = [0x6A09E667n,0xBB67AE85n,0x3C6EF372n,0xA54FF53An,0x510E527Fn,0x9B05688Cn,0x1F83D9ABn,0x5BE0CD19n];
const MID = [0xFD9FBEA2n,0x91243CE7n,0xBE499094n,0xCD2E1E0An,0x6C006F49n,0x04BD35ABn,0xFEB0A7E4n,0x03EFFBD2n];
const SCHED = [0xEB24BF9En,0x1558691Fn,0xA0C09EE2n,0x0CFA32BAn,0xA622EE8Cn,0xD1DD9491n,0xC0DD25A0n,0xF9E70AB6n,0xF0C31573n,0x7058CE4En,0x7188E606n,0x00E5AB33n,0xD258B060n,0x72766564n];
const K = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2].map(BigInt);
const ADJ = 0xC9DC06A7n;
const KB = K.slice(0,14).concat([ADJ], K.slice(15));
const S0ADJ = 0x059C0B80n, S1ADJ = 0x000B92C0n;
const CS = [[0xE82E91B1n,0xB32700D0n],[0x44DE24C6n,0x88DFF51Dn],[0x3BEB65BCn,0x29514038n],[0xC89C5933n,0xB328CBDFn],[0x8D1EC211n,0xD405B4D5n],[0x314EF5D5n,0x26E55F3Cn],[0xE92491B1n,0x607801C6n],[0xF0A5B9D5n,0x82B2C1FBn],[0x06064CF3n,0xFA51A3DAn],[0xDA79FA60n,0x207CC464n],[0xBED20560n,0x3C3C74F3n],[0x89F9C9F8n,0xD2D14B61n],[0x35FA38C6n,0xBB04A2C1n],[0xCB49E3C6n,0xC5626167n]];
const CSF = 0x82893933n, CSA0 = 0xF2F90B1An, CSA1 = 0x0B1A0000n;
const rol16 = v => { v &= M; return ((v << 16n) | (v >> 16n)) & M; };
const rotr = (x, n) => ((x >> n) | (x << (32n - n))) & M;
const sig0 = v => ((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & M;
const sig1 = v => ((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & M;
function rounds(state, w, first = 0) {
  let [a,b,c,d,e,f,g,h] = state;
  const k = first === 14 ? KB : K;
  for (let i = first; i < 64; i++) {
    const t1 = (h + (rotr(e,6n) ^ rotr(e,11n) ^ rotr(e,25n)) + (g ^ (e & (f ^ g))) + k[i] + w[i]) & M;
    const t2 = ((rotr(a,2n) ^ rotr(a,13n) ^ rotr(a,22n)) + ((a & b) | (c & (a | b)))) & M;
    h = g; g = f; f = e; e = (d + t1) & M; d = c; c = b; b = a; a = (t1 + t2) & M;
  }
  return [a,b,c,d,e,f,g,h];
}
function expand(w, first = 16) {
  for (let i = first; i < 64; i++) w.push((sig1(w[i-2]) + w[i-7] + sig0(w[i-15]) + w[i-16]) & M);
}
const be = (bytes, off, n) => { let v = 0n; for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(bytes[off+i]); return v; };
function shaInit(d7) {
  const w = new Array(14).fill(0n); w.push(be(d7,0,3)); w.push(be(d7,3,4));
  for (let i = 16; i < 30; i++) {
    let v = SCHED[i-16];
    if (i-2 >= 14) v += i === 16 ? (sig1(w[i-2]) ^ S1ADJ) : sig1(w[i-2]);
    if (i-7 >= 14) v += w[i-7];
    if (i-15 >= 14) v += i === 29 ? (sig0(w[i-15]) ^ S0ADJ) : sig0(w[i-15]);
    w.push(v & M);
  }
  w.push((sig1(w[28]) + w[23] + sig0(w[15]) + w[14] + ADJ - K[14]) & M);
  expand(w, 31);
  const r = rounds(MID, w, 14);
  return H0.map((x, i) => (x + r[i]) & M);
}
function shaDigest(data) {
  const len = 57 + data.length;
  const padLen = (((55 - len) % 64) + 64) % 64;
  const rest = data.slice(7);
  const p = new Uint8Array(rest.length + 1 + padLen + 8);
  p.set(rest, 0); p[rest.length] = 0x80;
  let bits = BigInt(len * 8);
  for (let i = 0; i < 8; i++) { p[p.length - 1 - i] = Number(bits & 0xFFn); bits >>= 8n; }
  let st = shaInit(data.slice(0, 7));
  for (let off = 0; off < p.length; off += 64) {
    const w = []; for (let i = 0; i < 16; i++) w.push(be(p, off + i*4, 4));
    expand(w);
    const r = rounds(st, w);
    st = st.map((x, i) => (x + r[i]) & M);
  }
  const out = new Uint8Array(32);
  st.forEach((x, i) => { for (let j = 0; j < 4; j++) out[i*4+j] = Number((x >> BigInt(24 - 8*j)) & 0xFFn); });
  return out;
}
function wordsLE(data) {
  const pad = (4 - data.length % 4) % 4;
  const b = new Uint8Array(data.length + pad); b.set(data);
  const w = []; for (let i = 0; i < b.length; i += 4) w.push(BigInt(b[i]) | (BigInt(b[i+1]) << 8n) | (BigInt(b[i+2]) << 16n) | (BigInt(b[i+3]) << 24n));
  if (w.length % 2) w.push(0n);
  return w;
}
function cs64(data, digest) {
  const le = o => BigInt(digest[o]) | (BigInt(digest[o+1]) << 8n) | (BigInt(digest[o+2]) << 16n) | (BigInt(digest[o+3]) << 24n);
  const ka = le(0) | 1n, kb = le(4) | 1n;
  const fac = [(ka * CSF) & M, (kb * CSF) & M];
  const terms = CS.map(([c], i) => (c * fac[i % 2]) & M);
  const offs = CS.map(([, o]) => o);
  const pre = new Uint8Array(data.length + 1); pre.set(data, 1);
  wordsLE(pre).forEach((word, i) => {
    let term = word * (i % 2 === 0 ? ka : kb);
    let off = rol16(word) * (i % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn);
    if (i === 0) { term += CSA0 * fac[0]; off += CSA1; }
    terms.push(term & M); offs.push(off & M);
  });
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i+1];
    let t = rol16((offs[i] + x) & M); let q = (t * 0x76F50F34n) & M;
    swapAcc += (rol16(q) * 0xC3EFEA97n + q) & M;
    t = rol16((offs[i+1] + y) & M); q = (t * 0x1881CE3Cn) & M;
    swapLast = (rol16(q) * 0x35BD1EC9n + q) & M;
    swapAcc = (swapAcc + swapLast) & M;
    state = (state * ka + x) & M;
    state = (rol16(state) * 0xCF98B111n) & M;
    state = (rol16(state) * 0x87085B9Fn) & M;
    state = (rol16(state) * 0x12CEB96Dn) & M;
    state = (rol16(state) * 0x257E1D83n) & M;
    acc += state;
    t = (state * kb + y) & M;
    t = (rol16(t) * 0xA27416F5n) & M;
    t = (rol16(t) * 0xD38396FFn) & M;
    state = (rol16((rol16(t) * 0x7C932B89n) & M) * 0xBFA49F69n) & M;
    acc = (acc + state) & M;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}
const hexU = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
function secMsGecV2(unixSeconds, token) {
  let ticks = unixSeconds + 11644473600;
  ticks -= ticks % 300;
  const str = BigInt(Math.round(ticks)) * 10000000n;
  const data = new TextEncoder().encode(str.toString() + token);
  const digest = shaDigest(data);
  const [c0, c1] = cs64(data, digest);
  const cb = new Uint8Array(8);
  for (let j = 0; j < 4; j++) { cb[j] = Number((c0 >> BigInt(8*j)) & 0xFFn); cb[4+j] = Number((c1 >> BigInt(8*j)) & 0xFFn); }
  return hexU(cb) + '-' + hexU(digest);
}
// ---- end token ----

let clockSkew = 0;   // seconds; corrected from Microsoft's clock if a request is refused
function secMsGec() { return secMsGecV2(Date.now() / 1000 + clockSkew, TOKEN); }

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function stamp() {
  // JavaScript-style date, e.g. "Tue Oct 27 2026 07:45:12 GMT+0000 (Coordinated Universal Time)"
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getUTCDay()]} ${mons[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

async function openSocket() {
  const url = `${WSS}&ConnectionId=${randomHex(16).toLowerCase()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=2-${CHROMIUM}`;
  return fetch(url, {
    headers: {
      'Upgrade': 'websocket',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36 Edg/${MAJOR}.0.0.0`,
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': `muid=${randomHex(16)};`
    }
  });
}

async function synthesize(text, voice, rate, pitch) {
  let resp = await openSocket();
  if (!resp.webSocket && resp.status === 403) {
    // Same as edge-tts: line our clock up with Microsoft's and try once more.
    const server = Date.parse(resp.headers.get('Date') || '');
    if (!isNaN(server)) { clockSkew += (server - Date.now()) / 1000; resp = await openSocket(); }
  }
  const ws = resp.webSocket;
  if (!ws) throw new Error('Microsoft refused the connection (HTTP ' + resp.status + ')');
  ws.accept();

  const chunks = [];
  const seen = [];          // what Microsoft sent back, for error messages
  let closeInfo = '';
  let pending = Promise.resolve();
  const done = new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); pending.then(resolve); };
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout; got: ' + seen.join(', '))); }, 20000);
    ws.addEventListener('message', ev => {
      const data = ev.data;
      if (typeof data === 'string') {
        const path = (data.match(/Path:([^\r\n]+)/) || [])[1] || 'text';
        seen.push(path);
        if (path === 'turn.end') { try { ws.close(); } catch (e) {} finish(); }
        return;
      }
      // Binary audio can arrive as an ArrayBuffer, a typed array or a Blob.
      pending = pending.then(async () => {
        let buf;
        if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
        else if (ArrayBuffer.isView(data)) buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        else if (data && typeof data.arrayBuffer === 'function') buf = new Uint8Array(await data.arrayBuffer());
        else { seen.push('unknown:' + typeof data); return; }
        if (buf.length < 2) return;
        const headLen = (buf[0] << 8) | buf[1];
        const head = new TextDecoder().decode(buf.subarray(2, 2 + headLen));
        const path = (head.match(/Path:([^\r\n]+)/) || [])[1] || 'binary';
        if (!seen.includes('bin:' + path)) seen.push('bin:' + path);
        const audio = buf.subarray(2 + headLen);
        if (path === 'audio' && audio.length) chunks.push(audio.slice());
      });
    });
    ws.addEventListener('close', ev => { closeInfo = `closed ${ev.code}${ev.reason ? ' ' + ev.reason : ''}`; finish(); });
    ws.addEventListener('error', ev => { seen.push('error ' + (ev.message || '')); });
  });

  ws.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
  ws.send(`X-RequestId:${randomHex(16).toLowerCase()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);

  await done;
  if (!chunks.length) throw new Error(`no audio received (got: ${seen.join(', ') || 'nothing'}; ${closeInfo || 'still open'})`);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Free brain models, tried in order until one answers.
const CHAT_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.2-3b-instruct'
];

async function chat(env, body, headers) {
  if (!env || !env.AI) {
    return new Response('The free brain needs a Workers AI binding named AI on this worker.', { status: 501, headers: { ...headers, 'content-type': 'text/plain' } });
  }
  const system = String(body.system || '').slice(0, 6000);
  const turns = (Array.isArray(body.messages) ? body.messages : []).slice(-14)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    return new Response('Send messages ending with the child\'s question.', { status: 400, headers });
  }
  const messages = system ? [{ role: 'system', content: system }, ...turns] : turns;
  let lastError = '';
  for (const model of CHAT_MODELS) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: 220, temperature: 0.8 });
      const text = String((out && (out.response ?? out.result?.response ?? out.choices?.[0]?.message?.content)) || '').trim();
      if (text) return new Response(JSON.stringify({ text, model }), { headers: { ...headers, 'content-type': 'application/json' } });
      lastError = model + ' gave no text';
    } catch (e) { lastError = model + ': ' + (e.message || e); }
  }
  const limit = /neuron|limit|quota|429/i.test(lastError);
  return new Response('Brain error: ' + lastError, { status: limit ? 429 : 502, headers: { ...headers, 'content-type': 'text/plain' } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') return new Response('Mario voice relay is running. Wahoo!', { headers: { ...headers, 'content-type': 'text/plain' } });
    if (request.method !== 'POST') return new Response('Use POST', { status: 405, headers });
    if (origin && !ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + ':'))) {
      return new Response('This relay only works for the Talk to Mario app.', { status: 403, headers });
    }
    let body;
    try { body = await request.json(); } catch (e) { return new Response('Send JSON like {"text":"Wahoo!"}', { status: 400, headers }); }
    if (new URL(request.url).pathname.replace(/\/+$/, '') === '/chat') return chat(env, body, headers);
    const text = String(body.text || '').trim().slice(0, 1500);
    if (!text) return new Response('No text', { status: 400, headers });
    const voice = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/.test(body.voice || '') ? body.voice : DEFAULTS.voice;
    const rate = /^[+-]\d{1,3}%$/.test(body.rate || '') ? body.rate : DEFAULTS.rate;
    const pitch = /^[+-]\d{1,3}Hz$/.test(body.pitch || '') ? body.pitch : DEFAULTS.pitch;
    try {
      const mp3 = await synthesize(text, voice, rate, pitch);
      return new Response(mp3, { headers: { ...headers, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
    } catch (e) {
      return new Response('Voice error: ' + e.message, { status: 502, headers: { ...headers, 'content-type': 'text/plain' } });
    }
  }
};
