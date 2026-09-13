// Envoi d'e-mails transactionnels. nodemailer est en import dynamique : si le
// paquet n'est pas installé (ou si aucun SMTP n'est configuré), le serveur
// démarre quand même et le lien est journalisé au lieu d'être envoyé.
import { config } from './config.js';

let transport = null;
let warned = false;

async function getTransport() {
  if (transport) return transport;
  const { default: nodemailer } = await import('nodemailer'); // npm i nodemailer
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // 465 = TLS implicite ; 25/587 = STARTTLS opportuniste (Postfix local).
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
  });
  return transport;
}

// Retourne true si l'e-mail est parti. En l'absence de SMTP, journalise le lien
// (pratique en dev) et retourne false — l'appelant ne doit pas le dire à
// l'utilisateur, pour ne pas révéler l'existence du compte.
export async function sendMail({ to, subject, text, html }) {
  if (!config.smtp.host) {
    if (!warned) {
      console.warn('✉️  SMTP_HOST non configuré : les e-mails sont journalisés, pas envoyés.');
      warned = true;
    }
    console.log(`✉️  [non envoyé] à ${to} — ${subject}\n${text}`);
    return false;
  }
  try {
    const t = await getTransport();
    const info = await t.sendMail({ from: config.smtp.from, to, subject, text, html });
    console.log(JSON.stringify({ t: new Date().toISOString(), event: 'mail.sent', to, subject, id: info.messageId }));
    return true;
  } catch (err) {
    console.error('[mail] échec envoi à', to, err.message);
    return false;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function verificationEmail(link, hours) {
  const subject = 'Confirmez votre adresse e-mail — AdCraft';
  const text = [
    'Bienvenue sur AdCraft.',
    '',
    'Confirmez votre adresse pour activer vos générations offertes :',
    link,
    '',
    `Ce lien est valable ${hours} heures et ne fonctionne qu'une fois.`,
    "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : aucun compte ne sera activé.",
  ].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f9f9f8;font-family:Inter,Arial,sans-serif;color:#1a1c1c">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;margin:0 0 16px">Confirmez votre adresse e-mail</h1>
    <p style="font-size:14px;line-height:20px;color:#434655;margin:0 0 24px">Une dernière étape pour activer vos générations offertes sur AdCraft.</p>
    <p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:11px 22px;border-radius:4px;font-size:14px;font-weight:600">Confirmer mon adresse</a></p>
    <p style="font-size:12px;line-height:18px;color:#625d5b;margin:0 0 8px">Si le bouton ne fonctionne pas, copiez ce lien :<br><span style="color:#1d4ed8;word-break:break-all">${esc(link)}</span></p>
    <p style="font-size:12px;line-height:18px;color:#747686;margin:16px 0 0">Lien valable ${hours} heures, utilisable une seule fois. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.</p>
  </div></body></html>`;
  return { subject, text, html };
}
