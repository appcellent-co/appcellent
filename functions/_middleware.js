// Cloudflare Pages Function — host-bazlı yönlendirme.
// <sub>.appcellent.com → /<sub>/…  ·  apex → /main/…  ·  "/" → "/home"
// Eski appcellent.co (+ alt alanları) ve www → aynı yolla appcellent.com'a 301.
// Kendi alan adı olan app'lerin alt siteleri kaldırıldı → o alan adına tek adımda 301.
// Önce prefix'li yol denenir; 404 ise ham yol (paylaşılan /styles, /img) denenir.
// /api/* → functions/api altındaki fonksiyonlara bırakılır.

// Hâlâ burada barınan alt siteler (kendi alan adı olmayanlar).
const HOSTS = new Set(['getby', 'limify']);

// Kendi sitesine taşınan app'ler. App Store / Play listelerindeki eski
// privacy/terms/faq linkleri de bu sayede doğru sayfaya düşer.
const MOVED = {
  studfinder: 'https://thestudfinder.app',
  protractor: 'https://protractorapp.com',
  tcgvault: 'https://tcgvault.io',
  volumebooster: 'https://thevolumebooster.app',
  colorzy: 'https://coloringmaker.app',
  decibelmeter: 'https://noiselevel.app',
};
// Yayında olmayan app'ler → ana site.
const RETIRED = new Set(['metaldetector', 'dartsscorer']);
// Ana sitede kaldırılan sayfalar.
const MAIN_REDIRECTS = {
  '/help/billing-and-subscriptions': '/help',
  '/help/billing-and-subscriptions.html': '/help',
};

const movedPath = (p) => {
  const m = p.replace(/\.html$/, '').replace(/\/+$/, '').match(/^\/(privacy|terms|faq|support)$/);
  if (!m) return '/';
  return m[1] === 'support' ? '/faq/' : `/${m[1]}/`;
};

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const m = url.hostname.match(/^(?:(.+)\.)?appcellent\.co(m?)$/);
  const sub = m?.[1] && m[1] !== 'www' ? m[1] : '';

  if (MOVED[sub]) return Response.redirect(MOVED[sub] + movedPath(url.pathname), 301);
  if (RETIRED.has(sub)) return Response.redirect('https://appcellent.com/', 301);

  if (m && (!m[2] || m[1] === 'www')) {
    return Response.redirect(`https://${sub ? `${sub}.` : ''}appcellent.com${url.pathname}${url.search}`, 301);
  }

  if (url.pathname.startsWith('/api/')) return next();

  const prefix = HOSTS.has(sub) ? sub : 'main';
  if (prefix === 'main' && MAIN_REDIRECTS[url.pathname]) {
    return Response.redirect(new URL(MAIN_REDIRECTS[url.pathname], url).toString(), 301);
  }
  if (url.pathname.startsWith(`/${prefix}/`)) return env.ASSETS.fetch(request);
  const path = url.pathname === '/' ? '/home' : url.pathname;

  const tryAsset = (p) => { const u = new URL(url); u.pathname = p; return env.ASSETS.fetch(new Request(u, request)); };
  let res = await tryAsset(`/${prefix}${path}`);
  if (res.status === 404) res = await tryAsset(url.pathname);
  return res;
}
