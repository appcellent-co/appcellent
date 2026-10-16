#!/usr/bin/env node
// appcellent.com/updates ("What's new") sayfasını App Store sürüm geçmişinden üretir.
//
// Kaynak: her app'in herkese açık App Store sayfası (us) — sürüm no, tarih ve "What's New" notları orada gömülü.
// Otomatik: .github/workflows/updates.yml günde 3 kez koşar; değişiklik varsa commit + Cloudflare Pages deploy.
// Çıktı (bu repo'ya yazar, commit/deploy etmez):
//   main/updates.html  — sayfa (header/footer main/help.html'den alınır)
//   main/updates.xml   — RSS (sadece özellik güncellemeleri + ilk çıkışlar)
//   main/index.html    — <!-- updates:start --> … <!-- updates:end --> arasındaki "son güncellemeler" kartları
//
// Kullanım:
//   node scripts/updates.mjs            # üret
//   node scripts/updates.mjs --dry      # sadece özet yaz
// Göreli tarihler ("3 days ago") tarayıcıda hesaplanır → çıktı yalnız yeni sürüm gelince değişir.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const APPS = [
  { key: 'studfinder', name: 'Stud Finder', id: 6740814424, site: 'https://thestudfinder.app' },
  { key: 'protractor', name: 'Protractor', id: 6742701087, site: 'https://protractorapp.com' },
  { key: 'tcgvault', name: 'TCG Vault', id: 6758110523, site: 'https://tcgvault.io' },
  { key: 'volumebooster', name: 'Volume Booster', id: 6760180638, site: 'https://thevolumebooster.app' },
  { key: 'colorzy', name: 'Colorzy', id: 6772468073, site: 'https://coloringmaker.app' },
  { key: 'decibelmeter', name: 'Decibel Meter', id: 6793045784, site: 'https://noiselevel.app' },
];

// "Bug fixes" türü içi boş notlar → küçük satır.
const GENERIC = /^(this (stud finder )?update includes )?(stability improvements|bug fixes|performance improvements)( and (bug fixes|stability improvements|performance improvements))?\.?$/i;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtMonth = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
// Göreli tarih tarayıcıda yazılır (REL_JS); HTML'de mutlak tarih kalır → her gün commit olmaz
const rel = (d) => `<time datetime="${d}" data-rel>${fmtDate(d)}</time>`;
const REL_JS = `
        document.querySelectorAll('time[data-rel]').forEach(t => {
            const n = Math.round((Date.now() - Date.parse(t.getAttribute('datetime') + 'T12:00:00Z')) / 864e5);
            if (n < 30) t.textContent = n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
        });`;
const major = (v) => /^\d+\.0(\.0)?$/.test(v) && v !== '1.0';

async function history(app) {
  const html = await (await fetch(`https://apps.apple.com/us/app/id${app.id}`, { headers: { 'User-Agent': UA } })).text();
  const i = html.indexOf('"page":"versionHistory"');
  const out = [];
  if (i >= 0) {
    const seg = html.slice(i, i + 300000);
    const re = /\{"\$kind":"TitledParagraph","text":"((?:[^"\\]|\\.)*)","style":"detail","wantsCollapsedNewlines":(?:true|false),"primarySubtitle":"([^"]*)","secondarySubtitle":"([^"]*)"\}/g;
    let m;
    while ((m = re.exec(seg))) out.push({ version: m[2], date: new Date(m[3]).toISOString().slice(0, 10), notes: JSON.parse(`"${m[1]}"`).trim() });
  }
  const look = (await (await fetch(`https://itunes.apple.com/lookup?id=${app.id}&country=us`)).json()).results?.[0];
  if (look) {
    const launch = look.releaseDate.slice(0, 10);
    if (!out.length && look.version !== '1.0') out.push({ version: look.version, date: look.currentVersionReleaseDate.slice(0, 10), notes: (look.releaseNotes || '').trim() });
    out.push({ version: '1.0', date: launch, notes: '', launch: true });
  }
  // sürümü yeni→eski sırala; bir önceki sürümle aynı notu taşıyan sürüm = düzeltme sürümü
  out.sort((a, b) => b.date.localeCompare(a.date) || (b.launch ? -1 : 1));
  for (let k = 0; k < out.length; k++) {
    const e = out[k];
    const older = out[k + 1];
    e.minor = !e.launch && (!e.notes || GENERIC.test(e.notes) || (older && older.notes && older.notes === e.notes));
    e.repeatOf = !e.launch && older && older.notes && older.notes === e.notes ? older.version : null;
  }
  return out.map((e) => ({ ...e, app }));
}

function notesHtml(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const intro = [], bullets = [];
  for (const l of lines) (/^[•\-–*]\s*/.test(l) ? bullets : bullets.length ? bullets : intro).push(l.replace(/^[•\-–*]\s*/, ''));
  let h = intro.map((p) => `<p>${esc(p)}</p>`).join('');
  if (bullets.length) h += `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
  return h;
}

function entryHtml(e) {
  const a = e.app;
  const store = `https://apps.apple.com/app/id${a.id}`;
  const tags = [];
  if (e.launch) tags.push('<span class="tag tag-dark">Launch</span>');
  else if (major(e.version)) tags.push('<span class="tag tag-dark">Major update</span>');
  if (daysAgo(e.date) <= 30) tags.push('<span class="tag tag-new">New</span>');
  if (e.minor) {
    const what = e.repeatOf ? `Fixes and refinements for version ${esc(e.repeatOf)}.` : 'Bug fixes and stability improvements.';
    return `<li class="upd upd-minor" data-app="${a.key}">
                        <img src="/img/apps/${a.key}.png" alt="" width="28" height="28" loading="lazy">
                        <span class="upd-line"><b>${esc(a.name)} ${esc(e.version)}</b> ${what}</span>
                        <time datetime="${e.date}">${fmtDate(e.date)}</time>
                    </li>`;
  }
  const body = e.launch
    ? `<p>${esc(a.name)} arrived on the App Store.</p>`
    : notesHtml(e.notes);
  return `<li class="upd${e.launch ? ' upd-launch' : ''}" data-app="${a.key}">
                        <div class="upd-head">
                            <img src="/img/apps/${a.key}.png" alt="" width="44" height="44" loading="lazy">
                            <div>
                                <h3>${esc(a.name)} <span class="ver">${e.launch ? 'v1.0' : 'v' + esc(e.version)}</span></h3>
                                <div class="upd-meta"><time datetime="${e.date}">${fmtDate(e.date)}</time>${tags.join('')}</div>
                            </div>
                        </div>
                        <div class="upd-body">${body}</div>
                        <div class="upd-links"><a class="text-link" href="${store}">Get it on the App Store</a><a class="arrow" href="${a.site}">${esc(a.name)} website</a></div>
                    </li>`;
}

function shell() {
  const help = fs.readFileSync(path.join(WEB, 'main/help.html'), 'utf8');
  let top = help.slice(0, help.indexOf('<main>'));
  const bottom = help.slice(help.indexOf('</main>') + '</main>'.length, help.indexOf('<script>'));
  const title = "What's New | Appcellent";
  const desc = 'Every update to Appcellent apps in one place: new features, big releases and fixes for Stud Finder, Protractor, TCG Vault, Volume Booster, Colorzy and Decibel Meter.';
  top = top.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${desc}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${desc}`)
    .replace(/https:\/\/appcellent\.com\/help"/g, 'https://appcellent.com/updates"')
    .replace(' aria-current="page"', '')
    .replace('<a href="/updates">What\'s new</a>', '<a href="/updates" aria-current="page">What\'s new</a>')
    .replace('</head>', '    <link rel="alternate" type="application/rss+xml" title="Appcellent updates" href="https://appcellent.com/updates.xml">\n</head>');
  // help sayfasının CTA bandını çıkar, footer kalsın
  const footer = bottom.slice(bottom.indexOf('<footer'));
  return { top, footer };
}

const MENU_JS = `
        const header = document.querySelector('.site-header');
        const menuBtn = document.querySelector('.menu-btn');
        const setMenu = (open) => {
            header.classList.toggle('menu-open', open);
            document.body.classList.toggle('no-scroll', open);
            menuBtn.setAttribute('aria-expanded', open);
        };
        menuBtn.addEventListener('click', () => setMenu(!header.classList.contains('menu-open')));
        document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => setMenu(false)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
        matchMedia('(min-width: 901px)').addEventListener('change', e => { if (e.matches) setMenu(false); });
        document.getElementById('year').textContent = new Date().getFullYear();`;

const PAGE_JS = `
        // Filtre: app seçimi + küçük düzeltmeleri göster/gizle; ?app= ile paylaşılabilir
        const list = document.querySelectorAll('.upd');
        const months = document.querySelectorAll('.month');
        const chips = [...document.querySelectorAll('.app-chip')];
        const fixes = document.getElementById('show-fixes');
        const empty = document.querySelector('.upd-empty');
        let current = new URLSearchParams(location.search).get('app') || 'all';
        const apply = () => {
            chips.forEach(c => c.setAttribute('aria-pressed', c.dataset.app === current));
            let shown = 0;
            list.forEach(li => {
                const ok = (current === 'all' || li.dataset.app === current) && (fixes.checked || !li.classList.contains('upd-minor'));
                li.hidden = !ok; if (ok) shown++;
            });
            months.forEach(m => { m.hidden = ![...m.querySelectorAll('.upd')].some(li => !li.hidden); });
            empty.hidden = shown > 0;
            const u = new URL(location.href);
            current === 'all' ? u.searchParams.delete('app') : u.searchParams.set('app', current);
            history.replaceState(null, '', u);
        };
        chips.forEach(c => c.addEventListener('click', () => {
            current = c.dataset.app; apply();
            if (window.scrollY > document.querySelector('.upd-tools').offsetTop) document.querySelector('.upd-tools').scrollIntoView({ behavior: 'smooth' });
        }));
        fixes.addEventListener('change', apply);
        if (!chips.some(c => c.dataset.app === current)) current = 'all';
        apply();`;

async function main() {
  const all = [];
  for (const app of APPS) {
    const h = await history(app);
    all.push(...h);
    console.log(`${app.name}: ${h.length} sürüm (son ${h[0]?.version} · ${h[0]?.date})`);
  }
  // Güvenlik: App Store sayfası bozuk/eksik dönerse eski sayfayı ezme
  const prev = fs.existsSync(path.join(WEB, 'main/updates.html')) ? fs.readFileSync(path.join(WEB, 'main/updates.html'), 'utf8') : '';
  const shrunk = APPS.filter((a) => all.filter((e) => e.app.key === a.key).length < (prev.match(new RegExp(`<li class="upd[^"]*" data-app="${a.key}"`, 'g')) || []).length);
  if (shrunk.length) throw new Error(`sürüm sayısı azaldı: ${shrunk.map((a) => a.name).join(', ')} — App Store sayfası değişmiş olabilir; app satıştan kalktıysa APPS listesinden çıkar`);
  all.sort((a, b) => b.date.localeCompare(a.date));
  const features = all.filter((e) => !e.minor);
  const minorCount = all.length - features.length;
  const since = all[all.length - 1].date;
  console.log(`toplam ${all.length} (özellik/çıkış ${features.length}, küçük ${minorCount}), ilk ${since}`);
  if (DRY) return;

  // Son sürümler şeridi
  const latest = APPS.map((a) => all.find((e) => e.app.key === a.key && !e.launch) || all.find((e) => e.app.key === a.key));
  const latestHtml = latest.map((e) => `                    <button class="latest app-chip" data-app="${e.app.key}" aria-pressed="false">
                        <img src="/img/apps/${e.app.key}.png" alt="" width="40" height="40">
                        <span><b>${esc(e.app.name)}</b><small>v${esc(e.launch ? '1.0' : e.version)} · ${rel(e.date)}</small></span>
                        ${daysAgo(e.date) <= 30 ? '<i class="dot" title="Updated in the last 30 days"></i>' : ''}
                    </button>`).join('\n');

  // Aylara göre grupla
  const byMonth = new Map();
  for (const e of all) { const k = e.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(e); }
  const timeline = [...byMonth.entries()].map(([k, es]) => `                <section class="month" aria-label="${fmtMonth(k + '-15')}">
                    <h2 class="month-label">${fmtMonth(k + '-15')}</h2>
                    <ol class="upd-list">
                    ${es.map(entryHtml).join('\n                    ')}
                    </ol>
                </section>`).join('\n');

  const { top, footer } = shell();
  const page = `${top}<main>
        <section class="page-hero">
            <div class="wrap">
                <h1>What's new</h1>
                <p class="lead">Every update to our apps in one place. New features up front, small fixes tucked away.</p>
                <p class="legal-meta">${all.length} updates since ${fmtMonth(since)} · <a class="text-link" href="/updates.xml">RSS feed</a></p>
            </div>
        </section>

        <div class="wrap upd-wrap">
            <div class="upd-tools">
                <div class="latest-row" role="group" aria-label="Filter by app">
                    <button class="latest latest-all app-chip" data-app="all" aria-pressed="true"><span><b>All apps</b><small>${features.length} feature updates</small></span></button>
${latestHtml}
                </div>
                <label class="switch"><input type="checkbox" id="show-fixes"><span class="switch-ui" aria-hidden="true"></span>Show bug-fix updates <small>(${minorCount})</small></label>
            </div>

            <div class="timeline">
${timeline}
                <p class="upd-empty" hidden>No feature updates for this app yet. Turn on "Show bug-fix updates" to see every release.</p>
            </div>
        </div>
    </main>

    <section class="cta-bar" aria-labelledby="cta-title">
        <div class="wrap">
            <div>
                <h2 id="cta-title">Have an idea for one of our apps?</h2>
                <p>Many updates start with a message from someone like you.</p>
            </div>
            <a class="btn btn-primary" href="/support">Suggest a feature</a>
        </div>
    </section>

    ${footer}
    <script>${MENU_JS}${PAGE_JS}${REL_JS}
    </script>
</body>

</html>
`;
  fs.writeFileSync(path.join(WEB, 'main/updates.html'), page);

  // RSS
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Appcellent: What's new</title>
  <link>https://appcellent.com/updates</link>
  <atom:link href="https://appcellent.com/updates.xml" rel="self" type="application/rss+xml"/>
  <description>New features and releases across Appcellent apps.</description>
  <language>en</language>
${features.slice(0, 40).map((e) => `  <item>
    <title>${esc(e.app.name)} ${e.launch ? 'launched' : esc(e.version)}</title>
    <link>https://appcellent.com/updates?app=${e.app.key}</link>
    <guid isPermaLink="false">${e.app.key}-${e.launch ? 'launch' : e.version}</guid>
    <pubDate>${new Date(e.date + 'T12:00:00Z').toUTCString()}</pubDate>
    <description>${esc(e.launch ? `${e.app.name} arrived on the App Store.` : e.notes)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;
  fs.writeFileSync(path.join(WEB, 'main/updates.xml'), rss);

  // Ana sayfa: son 3 özellik güncellemesi (farklı app'lerden)
  const seen = new Set(), recent = [];
  for (const e of features) { if (e.launch || seen.has(e.app.key)) continue; seen.add(e.app.key); recent.push(e); if (recent.length === 3) break; }
  const cards = recent.map((e) => {
    // "TCG Vault 2.0 is here!" gibi kısa başlık satırını atla, ilk anlamlı cümleyi göster
    const lines = e.notes.split(/\n+/).map((l) => l.replace(/^[•\-–*]\s*/, '').trim()).filter(Boolean);
    const first = lines.find((l) => l.length >= 40) || lines.join(' ');
    const short = first.length > 150 ? first.slice(0, first.lastIndexOf(' ', 147)) + '…' : first;
    return `                    <a class="card upd-card" href="/updates?app=${e.app.key}">
                        <div class="upd-card-head"><img src="/img/apps/${e.app.key}.png" alt="" width="36" height="36" loading="lazy"><div><b>${esc(e.app.name)} ${esc(e.version)}</b><small>${rel(e.date)}</small></div></div>
                        <p>${esc(short)}</p>
                        <span class="arrow">See what's new</span>
                    </a>`;
  }).join('\n');
  const idxPath = path.join(WEB, 'main/index.html');
  const idx = fs.readFileSync(idxPath, 'utf8');
  const block = `<!-- updates:start -->
        <section class="section recent-updates" aria-labelledby="recent-title">
            <div class="wrap">
                <div class="section-head-row">
                    <h2 id="recent-title">Recently updated</h2>
                    <a class="arrow" href="/updates">All updates</a>
                </div>
                <div class="cards">
${cards}
                </div>
            </div>
        </section>
        <script>${REL_JS}
        </script>
        <!-- updates:end -->`;
  const next = idx.includes('<!-- updates:start -->')
    ? idx.replace(/<!-- updates:start -->[\s\S]*?<!-- updates:end -->/, block)
    : idx.replace('<section class="section values"', `${block}\n\n        <section class="section values"`);
  fs.writeFileSync(idxPath, next);
  console.log('yazıldı: main/updates.html, main/updates.xml, main/index.html (son güncellemeler)');
}

main().catch((e) => { console.error(e); process.exit(1); });
