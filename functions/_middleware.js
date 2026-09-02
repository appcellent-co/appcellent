// Cloudflare Pages Function — vercel.json'daki host-bazlı rewrite'ların birebir karşılığı.
// <sub>.appcellent.co → /<sub>/…  ·  apex/www → /main/…  ·  "/" → "/home"
// Önce prefix'li yol denenir; 404 ise ham yol (paylaşılan /styles, /scripts, /assets) denenir.
const HOSTS = new Set(['getby', 'studfinder', 'metaldetector', 'tcgvault', 'protractor',
  'volumebooster', 'limify', 'colorzy', 'decibelmeter', 'dartsscorer']);

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const sub = url.hostname.replace(/\.appcellent\.co$/, '');
  const prefix = HOSTS.has(sub) ? sub : 'main';
  if (url.pathname.startsWith(`/${prefix}/`)) return env.ASSETS.fetch(request);
  const path = url.pathname === '/' ? '/home' : url.pathname;

  const tryAsset = (p) => { const u = new URL(url); u.pathname = p; return env.ASSETS.fetch(new Request(u, request)); };
  let res = await tryAsset(`/${prefix}${path}`);
  if (res.status === 404) res = await tryAsset(url.pathname);
  return res;
}
