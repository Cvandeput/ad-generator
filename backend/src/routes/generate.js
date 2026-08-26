import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import requireAuth from '../middleware/requireAuth.js';
import db, { OUTPUTS_DIR, UPLOADS_DIR } from '../db.js';

const router = Router();

// Thèmes autorisés (le texte réel du preset vit dans le workflow n8n).
const THEMES = ['classique', 'ete', 'extravagant', 'sport', 'fete', 'luxe', 'noel'];
const MAX_IMAGES = 14; // limite Nano Banana Pro (multi-références)
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Images gardées en mémoire puis persistées après création de la génération.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIME.includes(file.mimetype));
  },
});

const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de générations atteinte, réessayez plus tard' },
});

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_TOKEN = process.env.N8N_TOKEN || '';
const N8N_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS || 120000);

// Coût par image généré (USD) — à aligner avec le modèle utilisé par n8n.
// gemini-2.5-flash-image ≈ 0.039 ; gemini-3-pro-image ≈ 0.134.
const COST_PER_IMAGE_USD = Number(process.env.COST_PER_IMAGE_USD || 0.039);
const USD_TO_EUR = Number(process.env.USD_TO_EUR || 0.92);

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

router.post('/generate', requireAuth, generateLimiter, upload.array('images', MAX_IMAGES), async (req, res) => {
  const brand = String(req.body.brand || '').trim();
  const category = String(req.body.category || '').trim();
  const flavor = String(req.body.flavor || '').trim();
  const theme = String(req.body.theme || '').trim();
  const files = req.files || [];

  if (!brand) return res.status(400).json({ error: 'Marque requise' });
  if (!category) return res.status(400).json({ error: 'Catégorie requise' });
  if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Thème invalide' });
  if (files.length === 0) return res.status(400).json({ error: 'Au moins une image requise' });
  if (!N8N_WEBHOOK_URL) return res.status(500).json({ error: 'N8N_WEBHOOK_URL non configuré' });

  // Ligne "pending" créée d'abord : trace même si la génération échoue.
  const gen = db
    .prepare(
      `INSERT INTO generations (user_id, brand, category, flavor, theme, input_count, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(req.session.userId, brand, category, flavor || null, theme, files.length);
  const genId = gen.lastInsertRowid;

  // Persiste les images d'entrée.
  const inputDir = path.join(UPLOADS_DIR, String(genId));
  fs.mkdirSync(inputDir, { recursive: true });
  const images = files.map((f, i) => {
    const ext = EXT_BY_MIME[f.mimetype] || 'bin';
    fs.writeFileSync(path.join(inputDir, `input_${i + 1}.${ext}`), f.buffer);
    return { mimeType: f.mimetype, data: f.buffer.toString('base64') };
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

    const r = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(N8N_TOKEN ? { 'x-webhook-token': N8N_TOKEN } : {}),
      },
      body: JSON.stringify({ userId: req.session.userId, brand, category, flavor, theme, images }),
    }).finally(() => clearTimeout(timer));

    if (!r.ok) throw new Error(`n8n a répondu ${r.status}`);

    const payload = await r.json();
    const b64 = payload.image || payload.data;
    if (!b64) throw new Error("Pas d'image dans la réponse n8n");
    const mimeType = payload.mimeType || 'image/png';
    const promptUsed = payload.prompt || null;

    const ext = EXT_BY_MIME[mimeType] || 'png';
    const outPath = path.join(OUTPUTS_DIR, `${genId}.${ext}`);
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));

    db.prepare(
      `UPDATE generations SET status='done', output_path=?, mime_type=?, prompt_used=?, cost_usd=? WHERE id=?`
    ).run(outPath, mimeType, promptUsed, COST_PER_IMAGE_USD, genId);

    res.json({ id: genId, status: 'done', url: `/api/image/${genId}`, costUsd: COST_PER_IMAGE_USD });
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Délai dépassé (n8n/Gemini)' : err.message;
    db.prepare(`UPDATE generations SET status='error', error=? WHERE id=?`).run(message, genId);
    res.status(502).json({ id: genId, status: 'error', error: message });
  }
});

router.get('/history', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, brand, category, flavor, theme, status, mime_type, created_at
       FROM generations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`
    )
    .all(req.session.userId);
  res.json({
    generations: rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      category: r.category,
      flavor: r.flavor,
      theme: r.theme,
      status: r.status,
      createdAt: r.created_at,
      url: r.status === 'done' ? `/api/image/${r.id}` : null,
    })),
  });
});

// Suivi de consommation : ce mois, tout-temps, et 6 derniers mois.
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

  const withEur = (r) => ({ count: r.n, usd: r.usd, eur: r.usd * USD_TO_EUR });
  res.json({
    month,
    rate: USD_TO_EUR,
    currentMonth: withEur(cur),
    allTime: withEur(all),
    months: months.map((r) => ({ month: r.m, ...withEur(r) })),
  });
});

// Sert l'image générée. Vérifie l'appartenance au compte.
router.get('/image/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM generations WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.session.userId) {
    return res.status(404).json({ error: 'Introuvable' });
  }
  if (row.status !== 'done' || !row.output_path || !fs.existsSync(row.output_path)) {
    return res.status(404).json({ error: 'Image non disponible' });
  }

  const ext = EXT_BY_MIME[row.mime_type] || 'png';
  const filename = `${row.brand}-${row.theme}-${row.id}.${ext}`.replace(/[^a-zA-Z0-9.\-]/g, '_');
  res.type(row.mime_type || 'image/png');
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.sendFile(path.resolve(row.output_path));
});

export default router;
