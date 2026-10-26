// Mario voice relay — a Cloudflare Worker.
// The app sends text here; this worker asks Microsoft's Edge read-aloud service
// (the same one the Python edge-tts library uses) for the Diego voice and returns an MP3.
// Paste this whole file into a Cloudflare Worker and press Deploy.

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

async function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600;
  ticks -= ticks % 300;
  const value = BigInt(ticks) * 10000000n;
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.toString() + TOKEN)));
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function stamp() { return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)'); }

async function synthesize(text, voice, rate, pitch) {
  const url = `${WSS}&Sec-MS-GEC=${await secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM}&ConnectionId=${randomHex(16).toLowerCase()}`;
  const resp = await fetch(url, {
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
  const ws = resp.webSocket;
  if (!ws) throw new Error('Microsoft refused the connection (HTTP ' + resp.status + ')');
  ws.accept();

  const chunks = [];
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, 20000);
    ws.addEventListener('message', ev => {
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.end')) { clearTimeout(timer); try { ws.close(); } catch (e) {} resolve(); }
        return;
      }
      const buf = new Uint8Array(ev.data);
      if (buf.length < 2) return;
      const headLen = (buf[0] << 8) | buf[1];
      const head = new TextDecoder().decode(buf.slice(2, 2 + headLen));
      if (head.includes('Path:audio') && head.includes('audio/mpeg')) {
        const audio = buf.slice(2 + headLen);
        if (audio.length) chunks.push(audio);
      }
    });
    ws.addEventListener('close', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connection error')); });
  });

  ws.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
  ws.send(`X-RequestId:${randomHex(16).toLowerCase()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);

  await done;
  if (!chunks.length) throw new Error('no audio received');
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export default {
  async fetch(request) {
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
