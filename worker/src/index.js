// WazeBeepOnly — Cloudflare Worker
// Handles Waze voice pack upload with 3-layer security:
//   1. CORS (eyal71.github.io only)
//   2. Secret token header (X-Secret)
//   3. Rate limiting (5 uploads/hour/IP via KV)
//
// Waze blocks requests originating from Cloudflare's IP ranges, so the actual
// Waze login/upload can't happen inside the Worker. Instead this Worker triggers
// the "Upload Voice Pack to Waze" GitHub Actions workflow (which runs from a
// GitHub-hosted runner and isn't blocked), waits for it to finish, and returns
// the resulting install link.

const GITHUB_OWNER  = 'eyal71';
const GITHUB_REPO   = 'WazeBeepOnly';
const WORKFLOW_FILE = 'upload_voicepack.yml';

const VALID_SOUND_TYPES = new Set(['silent', 'beep1', 'beep2']);
const POLL_INTERVAL_MS  = 3000;
const MAX_POLL_MS       = 90_000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function gh(path, env, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'WazeBeepOnly-Worker',
      ...(opts.headers || {}),
    },
  });
  return res;
}

function validateEvents(events) {
  if (!events || typeof events !== 'object') return false;
  for (const [k, v] of Object.entries(events)) {
    if (!/^[A-Za-z0-9_]+$/.test(k)) return false;
    if (!VALID_SOUND_TYPES.has(v)) return false;
  }
  return true;
}

async function triggerWorkflow(packName, events, env) {
  const res = await gh(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    env,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: 'main',
        inputs: { pack_name: packName, events_json: JSON.stringify(events) },
      }),
    }
  );
  if (res.status !== 204)
    throw new Error(`Failed to trigger workflow: ${res.status} ${await res.text()}`);
}

async function findTriggeredRun(dispatchedAt, env, deadline) {
  while (Date.now() < deadline) {
    const res = await gh(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`,
      env
    );
    const data = await res.json();
    const run = (data.workflow_runs ?? []).find(
      r => new Date(r.created_at).getTime() >= dispatchedAt - 5000
    );
    if (run) return run;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for the workflow run to start');
}

async function waitForRunCompletion(runId, env, deadline) {
  while (Date.now() < deadline) {
    const res = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`, env);
    const run = await res.json();
    if (run.status === 'completed') return run;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for the workflow run to finish');
}

async function fetchInstallLink(env) {
  const res = await gh(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/waze_link.txt?ref=main`,
    env
  );
  if (!res.ok) throw new Error(`Failed to read waze_link.txt: ${res.status}`);
  const data = await res.json();
  return atob(data.content.replace(/\n/g, ''));
}

async function runUploadWorkflow(packName, events, env) {
  const dispatchedAt = Date.now();
  await triggerWorkflow(packName, events, env);

  const deadline = dispatchedAt + MAX_POLL_MS;
  const run = await findTriggeredRun(dispatchedAt, env, deadline);
  const finished = await waitForRunCompletion(run.id, env, deadline);

  if (finished.conclusion !== 'success')
    throw new Error(`Workflow run failed (${finished.conclusion}). See ${finished.html_url}`);

  return fetchInstallLink(env);
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

    try {
      const { pack_name, events } = await request.json();
      if (!validateEvents(events))
        return new Response(JSON.stringify({ error: 'Invalid events payload' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });

      const link = await runUploadWorkflow(pack_name || 'BeepOnly', events, env);
      return new Response(JSON.stringify({ link }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
