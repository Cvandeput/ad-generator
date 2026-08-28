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

// Champs texte libres partant dans un prompt image : on retire les caractères de
// contrôle (réduit la surface d'injection), on collapse les espaces et on tronque
// plutôt que rejeter. La vraie barrière reste structurelle — chaque champ ne
// touche qu'un bloc précis du prompt (cf. shared/prompt.mjs) : description → 1re
// ligne, art_direction → bloc SCÈNE, jamais la fidélité packaging.
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
// Partagé par /generate et /generation/:id/retry. La ligne `pending` (genId)
// doit déjà exister. Retourne le corps de réponse succès, ou lève une erreur
// enrichie ({ status, genId }) après avoir marqué la ligne en 'error'.
async function performGeneration(genId, { userId, brand, category, flavor, theme, description, artDirection }, images) {
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
      body: JSON.stringify({ userId, brand, category, flavor, theme, description, artDirection, images }),
    }).finally(() => clearTimeout(timer));

    if (!r.ok) throw new Error(`n8n a répondu ${r.status}`);

    const payload = await r.json();
    const b64 = payload.image || payload.data;
    if (!b64) throw new Error("Pas d'image dans la réponse n8n");
    const mimeType = payload.mimeType || 'image/png';
    const promptUsed = payload.prompt || null;
    // Source renvoyée par n8n ('manual'|'auto'|'fallback'). Repli si absente :
    // un décor manuel est 'manual' quoi qu'il arrive, sinon indéterminé.
    const artDirectionSource = payload.artDirectionSource || (artDirection ? 'manual' : null);

    const ext = EXT_BY_MIME[mimeType] || 'png';
    const outPath = path.join(OUTPUTS_DIR, `${genId}.${ext}`);
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));

    db.prepare(
      `UPDATE generations SET status='done', output_path=?, mime_type=?, prompt_used=?, art_direction_source=?, cost_usd=? WHERE id=?`
    ).run(outPath, mimeType, promptUsed, artDirectionSource, COST_PER_IMAGE_USD, genId);

    return { id: genId, status: 'done', url: `/api/image/${genId}`, costUsd: COST_PER_IMAGE_USD };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Délai dépassé (n8n/Gemini)' : err.message;
    db.prepare(`UPDATE generations SET status='error', error=? WHERE id=?`).run(message, genId);
    const wrapped = new Error(message);
    wrapped.status = 502;
    wrapped.genId = genId;
    throw wrapped;
  }
}

router.post('/generate', requireAuth, generateLimiter, upload.array('images', MAX_IMAGES), async (req, res) => {
  const brand = String(req.body.brand || '').trim();
  const category = String(req.body.category || '').trim();
  const flavor = String(req.body.flavor || '').trim();
  const theme = String(req.body.theme || '').trim();
  const description = cleanText(req.body.description, MAX_DESCRIPTION);
  const artDirection = cleanText(req.body.art_direction, MAX_ART_DIRECTION);
  const files = req.files || [];

  if (!brand) return res.status(400).json({ error: 'Marque requise' });
  if (!category) return res.status(400).json({ error: 'Catégorie requise' });
  if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Thème invalide' });
  if (files.length === 0) return res.status(400).json({ error: 'Au moins une image requise' });
  if (!N8N_WEBHOOK_URL) return res.status(500).json({ error: 'N8N_WEBHOOK_URL non configuré' });

  // Ligne "pending" créée d'abord : trace même si la génération échoue.
  const gen = db
    .prepare(
      `INSERT INTO generations (user_id, brand, category, flavor, theme, description, art_direction, input_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(req.session.userId, brand, category, flavor || null, theme, description || null, artDirection || null, files.length);
  const genId = gen.lastInsertRowid;

  // Persiste les images d'entrée (réutilisées par une éventuelle relance).
  const inputDir = path.join(UPLOADS_DIR, String(genId));
  fs.mkdirSync(inputDir, { recursive: true });
  const images = files.map((f, i) => {
    const ext = EXT_BY_MIME[f.mimetype] || 'bin';
    fs.writeFileSync(path.join(inputDir, `input_${i + 1}.${ext}`), f.buffer);
    return { mimeType: f.mimetype, data: f.buffer.toString('base64') };
  });

  try {
    const result = await performGeneration(genId, { userId: req.session.userId, brand, category, flavor, theme, description, artDirection }, images);
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({ id: err.genId || genId, status: 'error', error: err.message });
  }
});

// Relance une génération échouée à partir des images déjà stockées et des mêmes
// paramètres. Crée une NOUVELLE ligne : l'historique reste un journal.
router.post('/generation/:id/retry', requireAuth, generateLimiter, async (req, res) => {
  const orig = db.prepare('SELECT * FROM generations WHERE id = ?').get(Number(req.params.id));
  // 404 (et non 403) : on ne relance qu'une ligne qu'on possède ; pas de fuite
  // sur l'existence d'un id d'un autre compte.
  if (!orig || orig.user_id !== req.session.userId) {
    return res.status(404).json({ error: 'Introuvable' });
  }
  if (!N8N_WEBHOOK_URL) return res.status(500).json({ error: 'N8N_WEBHOOK_URL non configuré' });

  const images = readInputImages(orig.id);
  if (images.length === 0) {
    return res.status(400).json({ error: "Images d'entrée introuvables, relance impossible" });
  }

  const gen = db
    .prepare(
      `INSERT INTO generations (user_id, brand, category, flavor, theme, description, art_direction, input_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(orig.user_id, orig.brand, orig.category, orig.flavor, orig.theme, orig.description || null, orig.art_direction || null, images.length);
  const genId = gen.lastInsertRowid;

  // Copie les images d'entrée sous le nouvel id (chaque ligne garde les siennes,
  // relançable à son tour même si l'originale est supprimée plus tard).
  const srcDir = path.join(UPLOADS_DIR, String(orig.id));
  const dstDir = path.join(UPLOADS_DIR, String(genId));
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
  }

  try {
    const result = await performGeneration(
      genId,
      { userId: orig.user_id, brand: orig.brand, category: orig.category, flavor: orig.flavor || '', theme: orig.theme, description: orig.description || '', artDirection: orig.art_direction || '' },
      images
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({ id: err.genId || genId, status: 'error', error: err.message });
  }
});

// Suppression définitive : fichier de sortie + images d'entrée + ligne.
router.delete('/generation/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, user_id, output_path FROM generations WHERE id = ?').get(id);
  // 403 identique que la ligne existe ou non : pas de divulgation d'existence.
  if (!row || row.user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Interdit' });
  }

  // Fichier déjà absent → on n'échoue pas, on supprime la ligne quand même.
  if (row.output_path) {
    try {
      fs.unlinkSync(row.output_path);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  // Images d'entrée associées (évite les orphelins dans uploads/).
  fs.rmSync(path.join(UPLOADS_DIR, String(id)), { recursive: true, force: true });

  db.prepare('DELETE FROM generations WHERE id = ?').run(id);
  res.json({ ok: true, id });
});

// Historique. ?status=done|error|all (défaut done). La grille ne charge que les
// réussites ; `counts` permet au front de signaler les échecs sans les charger.
router.get('/history', requireAuth, (req, res) => {
  const uid = req.session.userId;
  let status = String(req.query.status || 'done').toLowerCase();
  if (!['done', 'error', 'all'].includes(status)) status = 'done';

  const filter = status === 'all' ? '' : ' AND status = ?';
  const params = status === 'all' ? [uid] : [uid, status];
  const rows = db
    .prepare(
      `SELECT id, brand, category, flavor, theme, description, status, error, mime_type, created_at
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
      createdAt: r.created_at,
      url: r.status === 'done' ? `/api/image/${r.id}` : null,
    })),
    counts,
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
