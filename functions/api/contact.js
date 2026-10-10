// POST /api/contact — appcellent.com/support formu → Resend ile support@appcellent.com'a mail.
// Gerekli secret: RESEND_API_KEY (wrangler pages secret put RESEND_API_KEY --project-name appcellent-web)
// Gönderen adres CONTACT_FROM ile değiştirilebilir; alan adının Resend'de doğrulanmış olması şart.
// Spam koruması: gizli "website" alanı (bot doldurur) + formun 3 sn'den kısa sürede gönderilmesi reddedilir.

const TO = 'support@appcellent.com';
const DEFAULT_FROM = 'Appcellent Support Form <form@mail.appcellent.com>';

const clean = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestPost({ request, env }) {
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  const reply = (ok, error) => wantsJson
    ? Response.json(ok ? { ok: true } : { ok: false, error }, { status: ok ? 200 : (error === 'invalid' ? 400 : 500) })
    : Response.redirect(new URL(ok ? '/support?sent=1' : `/support?error=${error}`, request.url).toString(), 303);

  let form;
  try { form = await request.formData(); } catch { return reply(false, 'invalid'); }

  // Bot: gizli alan dolu ya da form çok hızlı gönderildi → sessizce "gönderildi" de.
  const t0 = Number(form.get('t0'));
  if (clean(form.get('website'), 200) || (t0 && Date.now() - t0 < 3000)) return reply(true);

  const name = clean(form.get('name'), 100);
  const email = clean(form.get('email'), 200);
  const app = clean(form.get('app'), 60);
  const topic = clean(form.get('topic'), 60);
  const device = clean(form.get('device'), 120);
  const message = clean(form.get('message'), 5000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 5) return reply(false, 'invalid');
  if (!env.RESEND_API_KEY) return reply(false, 'config');

  const country = request.cf?.country || '';
  const rows = [['Name', name], ['Email', email], ['App', app], ['Topic', topic], ['Device', device], ['Country', country]]
    .filter(([, v]) => v);
  const text = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${message}`;
  const html = `<table style="font:14px -apple-system,Helvetica,Arial,sans-serif;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#949189">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>`)
    .join('')}</table><p style="font:15px/1.6 -apple-system,Helvetica,Arial,sans-serif;white-space:pre-wrap;margin-top:20px">${esc(message)}</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM || DEFAULT_FROM,
      to: [TO],
      reply_to: name ? `${name.replace(/[<>"]/g, '')} <${email}>` : email,
      subject: `[${app || 'Support'}] ${topic || 'Message'} from ${name || email}`,
      text,
      html,
    }),
  });
  if (!res.ok) {
    console.log('resend error', res.status, await res.text());
    return reply(false, 'send');
  }
  return reply(true);
}

