// Preview gate for the develop branch (preview.<site>) — never part of the production build.
//
// .github/workflows/preview.yml runs preview/prepare.sh after the build, which plugs this file
// in front of the site as the Pages Functions middleware (functions/_middleware.js). As a
// Worker entry (`main` in wrangler.preview.jsonc) the default export does the same job.
//
// What it does, so nothing about the live site's code has to change:
//   - one password for the whole preview: without the __preview cookie every request gets a
//     small password-only page (no username); the cookie lasts 30 days and stops working
//     when the password changes
//   - noindex everywhere: robots.txt Disallow: /, X-Robots-Tag header, robots meta in every page
//   - no analytics / ad tags: their <script src> tags are dropped and a tiny script in <head>
//     stops them being added later, so preview visits never reach GA4, Ads, Clarity, Plausible…
//
// Password = PREVIEW_PASSWORD (shared by every Appcellent preview; copy in
// ~/.config/appcellent/preview/password). Pages: project → Settings → Variables (Preview).
// No password set → every request is refused (fails closed).

const NOINDEX = 'noindex, nofollow';
const COOKIE = '__preview';
const LOGIN = '/__preview/login';
// Hosts whose scripts are never loaded on a preview.
const TRACKERS = 'googletagmanager\\.com|google-analytics\\.com|googleadservices\\.com|doubleclick\\.net|clarity\\.ms|plausible\\.io|connect\\.facebook\\.net|cloudflareinsights\\.com|bat\\.bing\\.com|analytics\\.tiktok\\.com|cdn\\.mxpnl\\.com|mixpanel\\.com|static\\.ads-twitter\\.com|oaistatic\\.com|openai\\.com';
const TRACKER_RE = new RegExp(TRACKERS);
const BLOCKER = `<script>(()=>{const B=/${TRACKERS}/;const bad=(n)=>n&&n.tagName==='SCRIPT'&&B.test(n.src||'');for(const m of['appendChild','insertBefore']){const o=Node.prototype[m];Node.prototype[m]=function(n,...r){return bad(n)?n:o.call(this,n,...r)}}})();</script>`;

// Pages Functions middleware.
export async function onRequest({ request, env, next }) {
  return guard(request, env.PREVIEW_PASSWORD, () => next());
}

// Worker entry (static assets binding ASSETS).
export default {
  fetch(request, env) {
    return guard(request, env.PREVIEW_PASSWORD, () => env.ASSETS.fetch(request));
  },
};

async function guard(request, password, serve) {
  if (!password) return plain('Preview password is not set.', 503);
  const url = new URL(request.url);
  const token = await sha256(`appcellent-preview:${password}`);

  if (url.pathname === LOGIN && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    let next = String(form?.get('next') ?? '/');
    if (!next.startsWith('/') || next.startsWith('//')) next = '/';
    if (!(await same(String(form?.get('password') ?? ''), password))) return loginPage(next, true);
    return new Response(null, {
      status: 303,
      headers: {
        Location: next,
        'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
        'X-Robots-Tag': NOINDEX,
        'Cache-Control': 'no-store',
      },
    });
  }

  const cookie = (request.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!cookie || !(await same(cookie, token))) return loginPage(url.pathname + url.search, false);

  if (url.pathname === '/robots.txt') return plain('User-agent: *\nDisallow: /\n', 200);
  return hide(await serve());
}

// noindex header on everything; in HTML pages also the robots meta + no tracker scripts.
function hide(res) {
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', NOINDEX);
  if (!(out.headers.get('Content-Type') || '').includes('text/html')) return out;
  out.headers.delete('Content-Length');
  return new HTMLRewriter()
    .on('head', { element: (e) => e.prepend(`<meta name="robots" content="${NOINDEX}">${BLOCKER}`, { html: true }) })
    .on('meta[name="robots"], meta[name="googlebot"]', { element: (e) => e.remove() })
    .on('script[src]', { element: (e) => { if (TRACKER_RE.test(e.getAttribute('src') || '')) e.remove(); } })
    .transform(out);
}

function plain(text, status) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': NOINDEX, 'Cache-Control': 'no-store' } });
}

function loginPage(next, wrong) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${NOINDEX}"><title>Preview</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.4 system-ui,sans-serif;background:#f4f4f5;color:#18181b}form{display:grid;gap:12px;width:min(320px,calc(100vw - 32px))}h1{margin:0 0 4px;font-size:20px}input,button{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid #d4d4d8}button{background:#18181b;color:#fff;border-color:#18181b;cursor:pointer}p{margin:0;color:#dc2626;font-size:14px}</style></head>
<body><form method="post" action="${LOGIN}"><h1>Preview</h1><input type="password" name="password" placeholder="Şifre" autocomplete="current-password" autofocus required><input type="hidden" name="next" value="${esc(next)}">${wrong ? '<p>Şifre yanlış.</p>' : ''}<button type="submit">Giriş</button></form></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': NOINDEX, 'Cache-Control': 'no-store' } });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison (hash both sides to equal length, no early exit).
async function same(a, b) {
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(await sha256(a)), enc.encode(await sha256(b)));
}
