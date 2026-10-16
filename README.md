# appcellent.com

Appcellent'ın şirket sitesi. Cloudflare Pages projesi `appcellent-web`.

## Yapı

- `main/` — appcellent.com (ana sayfa, Help Center + makaleler, Support, Privacy, Terms)
- `limify/`, `getby/` — Shopify app alt siteleri; appcellent.com'dan link YOK (Uponatime'a taşınacak, Shopify privacy URL'leri bozulmasın diye şimdilik yayında)
- `main/updates.html` + `updates.xml` — What's new; `scripts/updates.mjs` App Store sürüm geçmişinden üretir (ana sayfadaki "Recently updated" kartlarını da günceller).
  **Otomatik:** `.github/workflows/updates.yml` günde 3 kez (05:17/13:17/21:17 UTC) koşar; yeni sürüm varsa commit + deploy eder.
  Elle tetikleme: `gh workflow run updates.yml -R appcellent-co/appcellent`. Yeni app → `scripts/updates.mjs` içindeki `APPS` listesine ekle.
  Android: Play sürüm geçmişi vermediği için güncel sürüm her koşuda okunur ve `data/android.json`'a eklenir (Android'i olan app'te `APPS`'e `play: '<paket>'`).
- `styles/site.css` — tüm sayfaların tek stil dosyası (Kajabi tarzı; mavi #0048f4 sadece buton/link)
- `404.html` — tüm host'lar için ortak 404
- `functions/_middleware.js` — host'a göre yönlendirme:
  - `studfinder.`, `protractor.`, `tcgvault.`, `volumebooster.`, `colorzy.`, `decibelmeter.` → kendi alan adlarına 301
    (thestudfinder.app, protractorapp.com, tcgvault.io, thevolumebooster.app, coloringmaker.app, noiselevel.app)
  - `metaldetector.`, `dartsscorer.` → appcellent.com (yayında değil)
  - eski `*.appcellent.co` ve `www.` → aynı yolla `appcellent.com`
- `functions/api/contact.js` — Support formu → Resend → support@appcellent.com
  (secret `RESEND_API_KEY`, gönderen `form@mail.appcellent.com`; anahtar `~/.config/appcellent/resend/appcellent-web-form-key`)

## Yerel çalıştırma

```bash
sh build.sh && npx wrangler pages dev public
```

## Yayına alma

Bot `main`'e commit atıyor → deploy'dan önce `git pull` (yoksa eski What's new sayfası yayına gider).

```bash
sh build.sh && CLOUDFLARE_API_TOKEN=$(cat ~/.config/appcellent/cloudflare/api-token) npx wrangler pages deploy public --project-name appcellent-web --branch main
```
