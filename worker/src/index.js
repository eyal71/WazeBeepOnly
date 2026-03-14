// WazeBeepOnly — Cloudflare Worker
// Handles Waze voice pack upload with 3-layer security:
//   1. CORS (eyal71.github.io only)
//   2. Secret token header (X-Secret)
//   3. Rate limiting (5 uploads/hour/IP via KV)

// ─── Utilities ────────────────────────────────────────────────────────────────

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ─── Minimal Protobuf Encoder ─────────────────────────────────────────────────

function encodeVarint(n) {
  const out = [];
  let v = typeof n === 'bigint' ? n : BigInt(Math.trunc(Number(n)));
  if (v < 0n) v = BigInt.asUintN(64, v);
  do {
    let b = v & 0x7Fn;
    v >>= 7n;
    if (v > 0n) b |= 0x80n;
    out.push(Number(b));
  } while (v > 0n);
  return new Uint8Array(out);
}

function protoTag(fieldNum, wireType) {
  return encodeVarint(BigInt(fieldNum) * 8n + BigInt(wireType));
}

function encodeMsg(data, typedef) {
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    const fn = parseInt(k);
    const td = typedef?.[k] ?? {};
    const type = td.type ?? 'bytes';
    if (type === 'int') {
      parts.push(protoTag(fn, 0), encodeVarint(BigInt(v)));
    } else if (type === 'bytes') {
      const b = v instanceof Uint8Array ? v : new TextEncoder().encode(String(v));
      parts.push(protoTag(fn, 2), encodeVarint(BigInt(b.length)), b);
    } else if (type === 'message') {
      const inner = encodeMsg(v, td.message_typedef);
      parts.push(protoTag(fn, 2), encodeVarint(BigInt(inner.length)), inner);
    }
  }
  return concat(...parts);
}

function toProtoB64(data, typedef) {
  const raw = encodeMsg(data, typedef);
  let s = '';
  raw.forEach(b => s += String.fromCharCode(b));
  return 'ProtoBase64,' + btoa(s);
}

// ─── Minimal Protobuf Decoder ─────────────────────────────────────────────────

function readVarint(buf, off) {
  let val = 0n, shift = 0n;
  while (off < buf.length) {
    const b = BigInt(buf[off++]);
    val |= (b & 0x7Fn) << shift;
    if (!(b & 0x80n)) break;
    shift += 7n;
  }
  return { val, off };
}

function decodeMsg(buf, start = 0, end = buf.length) {
  const out = {};
  let off = start;
  while (off < end) {
    if (off >= buf.length) break;
    const tr = readVarint(buf, off); off = tr.off;
    const wt = Number(tr.val & 7n);
    const fn = String(tr.val >> 3n);
    let val;
    if (wt === 0) {
      const r = readVarint(buf, off); off = r.off; val = Number(r.val);
    } else if (wt === 2) {
      const lr = readVarint(buf, off); off = lr.off;
      const len = Number(lr.val);
      const data = buf.slice(off, off + len); off += len;
      try {
        const nested = decodeMsg(data, 0, data.length);
        val = Object.keys(nested).length > 0 ? nested : bytesToStr(data);
      } catch { val = bytesToStr(data); }
    } else if (wt === 1) { off += 8; continue; }
    else if (wt === 5) { off += 4; continue; }
    else break;
    if (val === undefined) continue;
    if (out[fn] === undefined) out[fn] = val;
    else if (Array.isArray(out[fn])) out[fn].push(val);
    else out[fn] = [out[fn], val];
  }
  return out;
}

function bytesToStr(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { let s = ''; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s); }
}

// ─── Waze Protobuf Typedefs ───────────────────────────────────────────────────

const TD_MAIN = {'1001':{type:'message',message_typedef:{'2184':{type:'message',message_typedef:{'1':{type:'int'},'3':{type:'bytes'},'5':{type:'bytes'},'6':{type:'bytes'},'11':{type:'bytes'},'16':{type:'bytes'},'17':{type:'bytes'},'18':{type:'int'},'19':{type:'int'},'22':{type:'message',message_typedef:{'1':{type:'message',message_typedef:{'1':{type:'bytes'},'2':{type:'bytes'}}}}},'24':{type:'message',message_typedef:{'1':{type:'int'},'2':{type:'int'},'3':{type:'int'}}},'25':{type:'bytes'},'26':{type:'bytes'},'28':{type:'int'}}}}}};
const TD_P2   = {'1001':{type:'message',message_typedef:{'2219':{type:'message',message_typedef:{}}}}};
const TD_P3A  = {'1001':{type:'message',message_typedef:{'2744':{type:'message',message_typedef:{'1':{type:'message',message_typedef:{'1':{type:'bytes'},'2':{type:'bytes'}}},'3':{type:'int'},'4':{type:'int'},'5':{type:'int'}}}}}};
const TD_P3B  = {'1001':{type:'message',message_typedef:{'2108':{type:'message',message_typedef:{'1':{type:'bytes'},'2':{type:'int'}}}}}};
const TD_VCE  = {'1001':{type:'message',message_typedef:{'2343':{type:'message',message_typedef:{'2':{type:'message',message_typedef:{'1':{type:'bytes'},'2':{type:'bytes'},'5':{type:'bytes'},'12':{type:'int'}}},'3':{type:'bytes'}}}}}};

// ─── Waze Authentication (3-step login) ──────────────────────────────────────

async function wazeLogin() {
  const u1 = crypto.randomUUID(), u2 = crypto.randomUUID(), u3 = crypto.randomUUID();
  const now = () => Math.floor(Date.now() / 1000);

  const main = {'1001':{'2184':{'1':234,'3':'4.106.0.1','5':'Waydroid','6':'WayDroid x86_64 Device','11':'11-SDK30','16':'en','17':u1,'18':50,'19':1,'22':{'1':{'1':'uid_enabled','2':'true'}},'24':{'1':2,'2':1920,'3':1137},'25':'en','26':u2,'28':now()}}};
  const p2   = {'1001':{'2219':{}}};
  const p3a  = {'1001':{'2744':{'1':{'1':'worldDATA','2':'RANDSTRINGDATA'},'3':0,'4':0,'5':1}}};
  const p3b  = {'1001':{'2108':{'1':u3,'2':1}}};

  let cookies = {};
  const jarHeader = () => Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');
  const updateJar = res => {
    const sc = res.headers.get('set-cookie') ?? '';
    for (const c of sc.split(',')) {
      const [kv] = c.trim().split(';');
      const eq = kv.indexOf('=');
      if (eq > 0) cookies[kv.slice(0,eq).trim()] = kv.slice(eq+1).trim();
    }
  };

  const hdrs = {'user-agent':'4.106.0.1','sequence-number':'1','x-waze-network-version':'3','x-waze-wait-timeout':'3500'};

  // Step 1 — initial login
  const r1 = await fetch('https://rt.waze.com/rtserver/distrib/login', {
    method: 'POST',
    headers: { ...hdrs, cookie: jarHeader() },
    body: toProtoB64(main, TD_MAIN) + '\nGetGeoServerConfig,world,T'
  });
  if (!r1.ok) throw new Error(`Waze step 1 failed: ${r1.status}`);
  updateJar(r1);

  // Step 2 — get anonymous credentials
  hdrs['sequence-number'] = '2';
  main['1001']['2184']['28'] = now();
  const r2 = await fetch('https://rtproxy-row.waze.com/rtserver/distrib/static', {
    method: 'POST',
    headers: { ...hdrs, cookie: jarHeader() },
    body: toProtoB64(main, TD_MAIN) + '\n' + toProtoB64(p2, TD_P2)
  });
  if (!r2.ok) throw new Error(`Waze step 2 failed: ${r2.status}`);
  updateJar(r2);

  const d2 = decodeMsg(new Uint8Array(await r2.arrayBuffer()));
  const d2k = Array.isArray(d2['1001']) ? d2['1001'][1] : d2['1001'];
  const anonUser = d2k['2220']['1'];
  const anonPass = d2k['2220']['2'];

  // Step 3 — authenticate with anon credentials, get session token
  hdrs['sequence-number'] = '3';
  main['1001']['2184']['28'] = now();
  p3a['1001']['2744']['1']['1'] = anonUser;
  p3a['1001']['2744']['1']['2'] = anonPass;
  const r3 = await fetch('https://rtproxy-row.waze.com/rtserver/distrib/login', {
    method: 'POST',
    headers: { ...hdrs, cookie: jarHeader() },
    body: toProtoB64(main, TD_MAIN) + '\n' + toProtoB64(p3a, TD_P3A) + '\n' + toProtoB64(p3b, TD_P3B)
  });
  if (!r3.ok) throw new Error(`Waze step 3 failed: ${r3.status}`);
  updateJar(r3);

  const d3 = decodeMsg(new Uint8Array(await r3.arrayBuffer()));
  const d3k = Array.isArray(d3['1001']) ? d3['1001'][1] : d3['1001'];
  const info = d3k['2745']['1'];
  const authToken    = info['3'];
  const globalServer = info['2'];
  const userId       = parseInt(info['1']);

  hdrs['uid'] = buildUid(userId, authToken);
  hdrs['sequence-number'] = '4';

  return { hdrs, globalServer, cookies };
}

function buildUid(userId, authToken) {
  const binId = userId.toString(2).padStart(31, '0');
  const parts = [0x12, parseInt(binId.slice(0, 3), 2)];
  const rem = binId.slice(3);
  for (let i = 0; i < 4; i++) {
    parts.push(parseInt('1' + rem.slice(i * 7, i * 7 + 7), 2));
  }
  parts.push(0x08);
  parts.reverse();
  const tb = typeof authToken === 'string' ? new TextEncoder().encode(authToken) : authToken;
  const lenHex = tb.length.toString(16).padStart(tb.length <= 0xff ? 2 : 4, '0');
  const lb = lenHex.match(/.{2}/g).map(h => parseInt(h, 16));
  const uid = new Uint8Array([...parts, ...lb, ...tb]);
  let s = ''; uid.forEach(b => s += String.fromCharCode(b));
  return btoa(s);
}

// ─── Waze Upload ──────────────────────────────────────────────────────────────

async function wazeUpload(tarBytes, packName) {
  const { hdrs, globalServer, cookies } = await wazeLogin();
  const packUuid = crypto.randomUUID();
  const cookieHdr = Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');

  const voiceData = {'1001':{'2343':{'2':{'1':packUuid,'2':packName,'5':globalServer,'12':0},'3':tarBytes}}};
  const r = await fetch('https://rtproxy-row.waze.com/rtserver/distrib/command', {
    method: 'POST',
    headers: { ...hdrs, cookie: cookieHdr },
    body: toProtoB64(voiceData, TD_VCE)
  });
  if (!r.ok) throw new Error(`Waze upload failed: ${r.status}`);
  return `https://waze.com/ul?acvp=${packUuid}`;
}

// ─── Rate Limiting (KV-based, 5/hour/IP) ─────────────────────────────────────

async function rateLimit(ip, kv) {
  const key = `rl:${ip}`;
  const now = Date.now();
  const raw = await kv.get(key);
  let times = raw ? JSON.parse(raw).filter(t => t > now - 3_600_000) : [];
  if (times.length >= 5) return false;
  times.push(now);
  await kv.put(key, JSON.stringify(times), { expirationTtl: 3600 });
  return true;
}

// ─── Request Body Parser ──────────────────────────────────────────────────────

async function parseBody(request) {
  const ct = request.headers.get('Content-Type') ?? '';
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    return {
      packName: form.get('pack_name') ?? 'BeepOnly',
      tarBytes: new Uint8Array(await form.get('tar').arrayBuffer())
    };
  }
  const { pack_name, tar } = await request.json();
  const bin = atob(tar);
  const tarBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) tarBytes[i] = bin.charCodeAt(i);
  return { packName: pack_name ?? 'BeepOnly', tarBytes };
}

// ─── Main Worker Handler ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin  = request.headers.get('Origin') ?? '';
    const allowed = ['https://eyal71.github.io', 'http://localhost', 'http://127.0.0.1'];
    const isAllowed = allowed.some(o => origin.startsWith(o));

    const cors = {
      'Access-Control-Allow-Origin':  isAllowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Secret',
    };

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors });

    // Layer 1: CORS origin check
    if (!isAllowed)
      return new Response('Forbidden', { status: 403 });

    if (request.method !== 'POST')
      return new Response('Method Not Allowed', { status: 405 });

    // Layer 2: Secret token check
    if (request.headers.get('X-Secret') !== env.SECRET_TOKEN)
      return new Response('Unauthorized', { status: 401 });

    // Layer 3: Rate limiting
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await rateLimit(ip, env.KV)))
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded (5 uploads/hour)' }),
        { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } }
      );

    // Upload
    try {
      const { packName, tarBytes } = await parseBody(request);
      const link = await wazeUpload(tarBytes, packName);
      return new Response(JSON.stringify({ link }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};
