import './env.js';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { db, getMeta } from './db.js';
import { sendLink } from './mail.js';
import { firefoxEligible, sourceReady } from './refresh.js';

const port = Number(process.env.PORT || 3000);
const site = process.env.SITE_URL || `http://localhost:${port}`;
const isLocal = new URL(site).hostname === 'localhost';
if (!isLocal && new URL(site).protocol !== 'https:') throw new Error('SITE_URL must use HTTPS outside localhost');
const cookieName = isLocal ? 'edit_session' : '__Host-edit_session';
const hash = value => createHash('sha256').update(value).digest('hex');
const gravatarHash = email => createHash('md5').update(email.trim().toLowerCase()).digest('hex');
const escapeHtml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const token = () => randomBytes(32).toString('hex');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const liveClients = new Set();
if (process.env.MAIL_MODE === 'local' || !process.env.MAIL_MODE) {
  watch(join(import.meta.dirname, 'public'), () => {
    for (const client of liveClients) client.write('data: reload\n\n');
  });
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=').map(decodeURIComponent)).filter(([k,v]) => k && v)); }
function session(req) {
  const value = cookies(req)[cookieName];
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  return db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash(value), Date.now()) || null;
}
function requireSession(req) {
  const s = session(req);
  if (!s || req.headers['x-csrf-token'] !== s.csrf || req.headers.origin !== site) throw Object.assign(new Error('Unauthorized'), { status: 403 });
  return s;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Expected JSON'), { status: 415 });
  let text = '';
  for await (const part of req) { text += part; if (text.length > 15000) throw Object.assign(new Error('Request too large'), { status: 413 }); }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function limited(key, max, interval) {
  const now = Date.now();
  db.prepare('DELETE FROM limits WHERE expires<?').run(now);
  const row = db.prepare('SELECT count,expires FROM limits WHERE key=?').get(key);
  if (row && row.count >= max) return true;
  db.prepare('INSERT INTO limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, expires=excluded.expires')
    .run(key, row ? row.count + 1 : 1, row?.expires || now + interval);
  return false;
}
function text(value, max) { if (typeof value !== 'string' || value.trim().length > max) throw Object.assign(new Error('Invalid profile field'), { status: 400 }); return value.trim(); }
function publicProfile(p) { return { name: p.name, place: p.place, lat: p.lat, lng: p.lng, status: p.status, interests: p.interests, bio: p.bio, website: p.website, projects: JSON.parse(p.projects), gravatar: p.gravatar }; }
const allowedStatus = new Set(['Just browsing', 'Open to meetups', 'Open to mentoring']);
async function handle(req, res) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://tiles.openfreemap.org https://www.gravatar.com; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const url = new URL(req.url, site);
  if (req.method === 'GET' && url.pathname === '/dev/reload' && (process.env.MAIL_MODE === 'local' || !process.env.MAIL_MODE)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write('data: connected\n\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/magic-links' && process.env.DEV_MAGIC_LINKS === '1' && process.env.MAIL_MODE === 'local' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
    const dir = resolve(process.env.DATA_DIR || './data', 'mail');
    const files = (await readdir(dir).catch(() => [])).filter(name => /^[a-f0-9-]{36}\.txt$/.test(name)).sort().reverse().slice(0, 100);
    const entries = await Promise.all(files.map(async name => {
      const mail = await readFile(join(dir, name), 'utf8');
      const email = mail.match(/^To: (.+)$/m)?.[1] || '';
      const link = mail.match(/^https?:\/\/\S+$/m)?.[0] || '';
      return `<li><strong>${escapeHtml(email)}</strong> <a href="${escapeHtml(link)}">Open verification link →</a></li>`;
    }));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local magic links</title><style>body{background:#121212;color:#ddd;font:14px monospace;max-width:720px;margin:60px auto;padding:20px}a{color:#ffc107}li{padding:12px;border-bottom:1px solid #333}</style></head><body><h1>Local magic links</h1><p>Development only. Newest first. Links expire after 20 minutes and work once.</p><ul>${entries.join('')}</ul><a href="/">← Back to map</a></body></html>`);
  }
  if (req.method === 'GET' && url.pathname === '/api/places') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 3 || q.length > 100 || limited(`geocode:${req.socket.remoteAddress}`, 30, 3600_000) || limited('geocode:global', 1, 1200)) return json(res, 429, { error: 'Enter a city, or wait a moment before trying again.' });
    const upstream = new URL('https://nominatim.openstreetmap.org/search');
    upstream.search = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '5' }).toString();
    const response = await fetch(upstream, { headers: { 'User-Agent': `EngineAtlas/0.1 (${site})`, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return json(res, 502, { error: 'Place search is temporarily unavailable.' });
    const places = (await response.json()).filter(p => p.address?.city || p.address?.town || p.address?.village || p.address?.municipality).map(p => ({ label: [p.address.city || p.address.town || p.address.village || p.address.municipality, p.address.state, p.address.country].filter(Boolean).join(', '), lat: Number(p.lat), lng: Number(p.lon) }));
    return json(res, 200, places);
  }
  if (req.method === 'GET' && url.pathname === '/api/profiles') {
    return json(res, 200, db.prepare('SELECT name,place,lat,lng,status,interests,bio,website,projects,gravatar FROM profiles WHERE published=1 ORDER BY updated_at DESC LIMIT 5000').all().map(publicProfile));
  }
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, Object.fromEntries(['chromium','firefox','webkit'].map(project => [project, { ready: sourceReady(project), updated: getMeta(`${project}_refreshed_at`) || null }])));
  if (req.method === 'POST' && url.pathname === '/api/request') {
    const email = String((await body(req)).email || '').trim().toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,253}$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    if (process.env.MAIL_MODE !== 'local' && (process.env.MAIL_MODE !== 'ses' || !process.env.SES_REGION || !process.env.SES_FROM)) return json(res, 503, { error: 'Email delivery is not configured.' });
    const message = { message: 'If this address is eligible, check your inbox.' };
    const ip = req.socket.remoteAddress; // Only trust the direct peer, not user-controlled forwarding headers.
    if (limited(`ip:${ip}`, 15, 3600_000) || limited(`email:${hash(email)}`, 3, 3600_000) || limited('global', 500, 3600_000)) return json(res, 200, message);
    const projects = ['chromium', 'webkit'].filter(project => sourceReady(project) && db.prepare('SELECT 1 FROM contributor_sources WHERE project=? AND email=?').get(project, email));
    try { if (await firefoxEligible(email)) projects.push('firefox'); }
    catch (error) {
      console.error('Firefox eligibility lookup failed:', error);
      if (!projects.length && !sourceReady('chromium') && !sourceReady('webkit')) return json(res, 503, { error: 'Contributor verification is temporarily unavailable.' });
    }
    if (!projects.length) return json(res, 200, message);
    const value = token();
    const digest = hash(value);
    db.prepare('DELETE FROM tokens WHERE email=? OR expires<?').run(email, Date.now());
    db.prepare('INSERT INTO tokens (hash,email,expires,projects) VALUES (?,?,?,?)').run(digest, email, Date.now() + 20 * 60_000, JSON.stringify(projects));
    try { await sendLink(email, `${site}/verify?token=${value}`); }
    catch (error) { db.prepare('DELETE FROM tokens WHERE hash=?').run(digest); console.error('Mail delivery failed:', error); return json(res, 503, { error: 'Email delivery is temporarily unavailable.' }); }
    return json(res, 200, message);
  }
  if (req.method === 'POST' && url.pathname === '/api/redeem') {
    if (req.headers.origin !== site) return json(res, 403, { error: 'Unauthorized' });
    const value = (await body(req)).token;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return json(res, 400, { error: 'Invalid or expired link.' });
    const record = db.prepare('DELETE FROM tokens WHERE hash=? AND expires>? RETURNING email,projects').get(hash(value), Date.now());
    if (!record) return json(res, 400, { error: 'Invalid or expired link.' });
    const sid = token(), csrf = token();
    db.prepare('DELETE FROM sessions WHERE email=? OR expires<?').run(record.email, Date.now());
    db.prepare('INSERT INTO sessions (hash,email,csrf,expires,projects) VALUES (?,?,?,?,?)').run(hash(sid), record.email, csrf, Date.now() + 30 * 60_000, record.projects);
    res.setHeader('Set-Cookie', `${cookieName}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${isLocal ? '' : '; Secure'}`);
    return json(res, 200, { csrf });
  }
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const s = session(req);
    if (!s) return json(res, 401, { error: 'Request a new link to edit your profile.' });
    const p = db.prepare('SELECT * FROM profiles WHERE email=?').get(s.email);
    return json(res, 200, { csrf: s.csrf, profile: p ? { ...publicProfile(p), published: !!p.published } : null });
  }
  if (req.method === 'POST' && url.pathname === '/api/profile') {
    const s = requireSession(req), data = await body(req);
    const name = text(data.name, 80), place = text(data.place, 100), bio = text(data.bio || '', 400), interests = text(data.interests || '', 120), status = text(data.status, 40), website = text(data.website || '', 200);
    const lat = Number(data.lat), lng = Number(data.lng);
    if (data.lat === '' || data.lng === '' || data.lat == null || data.lng == null) throw Object.assign(new Error('Choose your city from the suggestions before saving.'), { status: 400 });
    if (!name || !place || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !allowedStatus.has(status) || (website && (!/^https:\/\//.test(website) || !URL.canParse(website))) || typeof data.published !== 'boolean') throw Object.assign(new Error('Check your profile fields.'), { status: 400 });
    const existing = db.prepare('SELECT projects FROM profiles WHERE email=?').get(s.email);
    const projects = JSON.stringify([...new Set([...(existing ? JSON.parse(existing.projects) : []), ...JSON.parse(s.projects)])]);
    db.prepare(`INSERT INTO profiles (email,name,place,lat,lng,status,interests,bio,website,published,updated_at,projects,gravatar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,place=excluded.place,lat=excluded.lat,lng=excluded.lng,status=excluded.status,interests=excluded.interests,bio=excluded.bio,website=excluded.website,published=excluded.published,updated_at=excluded.updated_at,projects=excluded.projects,gravatar=excluded.gravatar`)
      .run(s.email, name, place, Math.round(lat * 10) / 10, Math.round(lng * 10) / 10, status, interests, bio, website, data.published ? 1 : 0, Date.now(), projects, gravatarHash(s.email));
    return json(res, 200, { message: 'Profile saved.' });
  }
  if (req.method === 'POST' && (url.pathname === '/api/hide' || url.pathname === '/api/delete')) {
    const s = requireSession(req);
    if (url.pathname === '/api/hide') db.prepare('UPDATE profiles SET published=0 WHERE email=?').run(s.email);
    else db.prepare('DELETE FROM profiles WHERE email=?').run(s.email);
    return json(res, 200, { message: url.pathname === '/api/hide' ? 'Profile hidden.' : 'Profile deleted.' });
  }
  if (req.method === 'GET') {
    if (url.pathname.startsWith('/img/')) {
      const name = url.pathname.slice(5);
      if (/^[a-z]+\.png$/.test(name)) {
        const content = await readFile(join(import.meta.dirname, 'public', 'img', name));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(content);
      }
    }
    const files = { '/': 'index.html', '/verify': 'index.html', '/edit': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/maplibre.js': '../node_modules/maplibre-gl/dist/maplibre-gl.js', '/maplibre.css': '../node_modules/maplibre-gl/dist/maplibre-gl.css' };
    const file = files[url.pathname];
    if (file) {
      const content = await readFile(join(import.meta.dirname, 'public', file));
      res.writeHead(200, { 'Content-Type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': url.pathname === '/verify' || url.pathname === '/edit' ? 'no-store' : 'no-cache' });
      return res.end(content);
    }
  }
  json(res, 404, { error: 'Not found' });
}
createServer((req, res) => handle(req, res).catch(error => { console.error('Request failed:', error.message); if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong.' }); })).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Engine Atlas at http://localhost:${port}`));
