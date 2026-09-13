import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import requireAuth from '../middleware/requireAuth.js';
import db, { OUTPUTS_DIR, UPLOADS_DIR } from '../db.js';
import { config } from '../config.js';
import { costForModel } from '../pricing.js';
import { THEMES, CATEGORIES, MAX_PRODUCTS } from '../../../shared/prompt.mjs';

const router = Router();

const MAX_IMAGES = 14; // limite Nano Banana Pro (multi-références)
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Images gardées en mémoire puis persistées après création de la génération.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_IMAGES, fields: 12, fieldSize: 4096, parts: 40 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

// Quota PAR COMPTE (c'est le compte qui coûte, pas l'IP) : horaire et journalier.
const perUser = (req) => `u:${req.session?.userId ?? req.ip}`;
const hourly = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.genPerHour,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Quota horaire atteint (${config.genPerHour} générations/heure)` },
});
const daily = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: config.genPerDay,
  keyGenerator: perUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: `Quota journalier atteint (${config.genPerDay} générations/jour)` },
});

// Champs texte libres partant dans un prompt image : on retire les caractères de
// contrôle (réduit la surface d'injection), on collapse les espaces et on tronque.
// Chaque champ ne touche qu'un bloc précis du prompt (cf. shared/prompt.mjs).
const MAX_BRAND = 60;
const MAX_FLAVOR = 60;
const MAX_DESCRIPTION = 120;
const MAX_ART_DIRECTION = 200;
const cleanText = (s, max) =>
  String(s || '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

// Type réel par signature (le Content-Type du multipart est déclaré par le
// client, donc contrôlé par l'attaquant). Retourne null si ce n'est pas une image.
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Coût USD d'une génération : modèle/taille renvoyés par n8n, sinon config.
function unitCost(model, imageSize) {
  if (config.costOverrideUsd != null) return { usd: config.costOverrideUsd, model: model || config.geminiModel, imageSize: imageSize || config.geminiImageSize || null };
  const m = model || config.geminiModel;
  const s = imageSize || config.geminiImageSize || null;
  const usd = costForModel(m, s);
  return { usd: usd ?? 0, model: m, imageSize: s, unknown: usd == null };
}

// Relit les images d'entrée d'une génération depuis le disque (pour la relance).
function readInputImages(genId) {
  const dir = path.join(UPLOADS_DIR, String(genId));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      return {
        mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
        data: fs.readFileSync(path.join(dir, name)).toString('base64'),
      };
    });
}

// Cœur de la génération : appelle n8n, stocke le résultat, met à jour la ligne.
async function performGeneration(genId, params, images) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.n8nTimeoutMs);

    const r = await fetch(config.n8nWebhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-webhook-token': config.n8nToken },
      body: JSON.stringify({ ...params, images }),
    }).finally(() => clearTimeout(timer));

    if (!r.ok) throw new Error(`n8n a répondu ${r.status}`);

    const payload = await r.json();
    const b64 = payload.image || payload.data;
    if (!b64) throw new Error("Pas d'image dans la réponse n8n");
    const buf = Buffer.from(b64, 'base64');
    const mimeType = sniffImage(buf) || payload.mimeType || 'image/png';
    const promptUsed = payload.prompt || null;
    const artDirectionSource = payload.artDirectionSource || (params.artDirection ? 'manual' : null);
    const cost = unitCost(payload.model, payload.imageSize);
    if (cost.unknown) console.warn(`[cost] modèle inconnu de la grille : ${cost.model} → coût 0 enregistré`);

    const ext = EXT_BY_MIME[mimeType] || 'png';
    const outPath = path.join(OUTPUTS_DIR, `${genId}.${ext}`);
    fs.writeFileSync(outPath, buf);

    db.prepare(
      `UPDATE generations SET status='done', output_path=?, mime_type=?, prompt_used=?, art_direction_source=?,
       cost_usd=?, model=?, image_size=? WHERE id=?`
    ).run(outPath, mimeType, promptUsed, artDirectionSource, cost.usd, cost.model, cost.imageSize, genId);

    return { id: genId, status: 'done', url: `/api/image/${genId}`, costUsd: cost.usd, costEur: cost.usd * config.usdToEur, model: cost.model };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Délai dépassé (n8n/Gemini)' : err.message;
    db.prepare(`UPDATE generations SET status='error', error=? WHERE id=?`).run(message, genId);
    const wrapped = new Error(message);
    wrapped.status = 502;
    wrapped.genId = genId;
    throw wrapped;
  }
}

function insertPending(p) {
  return db
    .prepare(
      `INSERT INTO generations (user_id, brand, category, flavor, theme, description, art_direction, product_count, input_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(p.userId, p.brand, p.category, p.flavor || null, p.theme, p.description || null, p.artDirection || null, p.productCount || null, p.inputCount).lastInsertRowid;
}

router.post('/generate', requireAuth, hourly, daily, upload.array('images', MAX_IMAGES), async (req, res) => {
  const brand = cleanText(req.body.brand, MAX_BRAND);
  const category = cleanText(req.body.category, 40).toLowerCase();
  const flavor = cleanText(req.body.flavor, MAX_FLAVOR);
  const theme = String(req.body.theme || '').trim();
  const description = cleanText(req.body.description, MAX_DESCRIPTION);
  const artDirection = cleanText(req.body.art_direction, MAX_ART_DIRECTION);
  const rawCount = String(req.body.product_count || '').trim();
  const productCount = rawCount ? Number(rawCount) : null;
  const files = req.files || [];

  if (!brand) return res.status(400).json({ error: 'Marque requise' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Catégorie invalide' });
  if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Thème invalide' });
  if (productCount != null && (!Number.isInteger(productCount) || productCount < 1 || productCount > MAX_PRODUCTS)) {
    return res.status(400).json({ error: `Nombre de produits : entier entre 1 et ${MAX_PRODUCTS}` });
  }
  if (files.length === 0) return res.status(400).json({ error: 'Au moins une image requise' });
  if (!config.n8nWebhookUrl) return res.status(500).json({ error: 'N8N_WEBHOOK_URL non configuré' });

  // Type réel de chaque fichier (signature), indépendamment du Content-Type déclaré.
  const sniffed = files.map((f) => sniffImage(f.buffer));
  if (sniffed.some((m) => !m)) return res.status(400).json({ error: 'Un des fichiers n’est pas une image JPEG/PNG/WebP valide' });

  const genId = insertPending({ userId: req.session.userId, brand, category, flavor, theme, description, artDirection, productCount, inputCount: files.length });

  // Persiste les images d'entrée (réutilisées par une éventuelle relance).
  const inputDir = path.join(UPLOADS_DIR, String(genId));
  fs.mkdirSync(inputDir, { recursive: true });
  const images = files.map((f, i) => {
    const mime = sniffed[i];
    fs.writeFileSync(path.join(inputDir, `input_${String(i + 1).padStart(2, '0')}.${EXT_BY_MIME[mime]}`), f.buffer);
    return { mimeType: mime, data: f.buffer.toString('base64') };
  });

  try {
    const result = await performGeneration(genId, { userId: req.session.userId, brand, category, flavor, theme, description, artDirection, productCount }, images);
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({ id: err.genId || genId, status: 'error', error: err.message });
  }
});

// Relance une génération échouée à partir des images déjà stockées et des mêmes
// paramètres. Crée une NOUVELLE ligne : l'historique reste un journal.
router.post('/generation/:id/retry', requireAuth, hourly, daily, async (req, res) => {
  const orig = db.prepare('SELECT * FROM generations WHERE id = ?').get(Number(req.params.id));
  // 404 (et non 403) : pas de fuite sur l'existence d'un id d'un autre compte.
  if (!orig || orig.user_id !== req.session.userId) return res.status(404).json({ error: 'Introuvable' });
  if (!config.n8nWebhookUrl) return res.status(500).json({ error: 'N8N_WEBHOOK_URL non configuré' });

  const images = readInputImages(orig.id);
  if (images.length === 0) return res.status(400).json({ error: "Images d'entrée introuvables, relance impossible" });

  const params = {
    userId: orig.user_id,
    brand: orig.brand,
    category: orig.category,
    flavor: orig.flavor || '',
    theme: orig.theme,
    description: orig.description || '',
    artDirection: orig.art_direction || '',
    productCount: orig.product_count || null,
  };
  const genId = insertPending({ ...params, inputCount: images.length });

  const srcDir = path.join(UPLOADS_DIR, String(orig.id));
  const dstDir = path.join(UPLOADS_DIR, String(genId));
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));

  try {
    res.json(await performGeneration(genId, params, images));
  } catch (err) {
    res.status(err.status || 502).json({ id: err.genId || genId, status: 'error', error: err.message });
  }
});

// Suppression définitive : fichier de sortie + images d'entrée + ligne.
router.delete('/generation/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Introuvable' });
  const row = db.prepare('SELECT id, user_id, output_path FROM generations WHERE id = ?').get(id);
  // Même réponse que la ligne existe ou non : pas de divulgation d'existence.
  if (!row || row.user_id !== req.session.userId) return res.status(404).json({ error: 'Introuvable' });

  if (row.output_path) {
    try {
      fs.unlinkSync(row.output_path);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  fs.rmSync(path.join(UPLOADS_DIR, String(id)), { recursive: true, force: true });
  db.prepare('DELETE FROM generations WHERE id = ?').run(id);
  res.json({ ok: true, id });
});

// Historique. ?status=done|error|all (défaut done).
router.get('/history', requireAuth, (req, res) => {
  const uid = req.session.userId;
  let status = String(req.query.status || 'done').toLowerCase();
  if (!['done', 'error', 'all'].includes(status)) status = 'done';

  const filter = status === 'all' ? '' : ' AND status = ?';
  const params = status === 'all' ? [uid] : [uid, status];
  const rows = db
    .prepare(
      `SELECT id, brand, category, flavor, theme, description, status, error, mime_type, cost_usd, model, created_at
       FROM generations WHERE user_id = ?${filter} ORDER BY created_at DESC, id DESC LIMIT 200`
    )
    .all(...params);

  const counts = { done: 0, error: 0 };
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM generations WHERE user_id = ? GROUP BY status`).all(uid)) {
    if (r.status in counts) counts[r.status] = r.n;
  }

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      category: r.category,
      flavor: r.flavor,
      theme: r.theme,
      description: r.description,
      status: r.status,
      error: r.error,
      costEur: r.cost_usd * config.usdToEur,
      model: r.model,
      createdAt: r.created_at,
      url: r.status === 'done' ? `/api/image/${r.id}` : null,
    })),
    counts,
  });
});

// Suivi de consommation : ce mois, tout-temps, 6 derniers mois + prix unitaire courant.
router.get('/usage', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
  const cur = db
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd FROM generations
       WHERE user_id=? AND status='done' AND strftime('%Y-%m', created_at)=?`
    )
    .get(uid, month);
  const all = db
    .prepare(`SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd FROM generations WHERE user_id=? AND status='done'`)
    .get(uid);
  const months = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) m, COUNT(*) n, COALESCE(SUM(cost_usd),0) usd
       FROM generations WHERE user_id=? AND status='done' GROUP BY m ORDER BY m DESC LIMIT 6`
    )
    .all(uid);

  const withEur = (r) => ({ count: r.n, usd: r.usd, eur: r.usd * config.usdToEur });
  const unit = unitCost();
  res.json({
    month,
    rate: config.usdToEur,
    unit: { usd: unit.usd, eur: unit.usd * config.usdToEur, model: unit.model, imageSize: unit.imageSize },
    quota: { perHour: config.genPerHour, perDay: config.genPerDay },
    currentMonth: withEur(cur),
    allTime: withEur(all),
    months: months.map((r) => ({ month: r.m, ...withEur(r) })),
  });
});

// Sert l'image générée. Vérifie l'appartenance au compte.
router.get('/image/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Introuvable' });
  const row = db.prepare('SELECT * FROM generations WHERE id = ?').get(id);
  if (!row || row.user_id !== req.session.userId) return res.status(404).json({ error: 'Introuvable' });
  if (row.status !== 'done' || !row.output_path || !fs.existsSync(row.output_path)) {
    return res.status(404).json({ error: 'Image non disponible' });
  }

  const ext = EXT_BY_MIME[row.mime_type] || 'png';
  const filename = `${row.brand}-${row.theme}-${row.id}.${ext}`.replace(/[^a-zA-Z0-9.\-]/g, '_');
  res.type(row.mime_type || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(path.resolve(row.output_path));
});

export default router;
