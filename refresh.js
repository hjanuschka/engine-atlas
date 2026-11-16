import { db, getMeta } from './db.js';

export const SOURCES = {
  chromium: 'https://chromium.googlesource.com/chromium/src/+/main/AUTHORS?format=TEXT',
  webkit: 'https://raw.githubusercontent.com/WebKit/WebKit/main/metadata/contributors.json',
  devtools: 'https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/AUTHORS'
};
export function parseAuthors(text) {
  const section = text.split('# BEGIN individuals section.')[1]?.split('# END individuals section.')[0];
  if (!section) throw new Error('Missing individuals section');
  const emails = new Set();
  for (const line of section.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^.+ <([^<>\s@]+@[^<>\s@]+)>$/.exec(line.trim());
    if (match) emails.add(match[1].toLowerCase());
  }
  return emails;
}
export function parseWebKit(text) {
  const people = JSON.parse(text);
  if (!Array.isArray(people)) throw new Error('Invalid WebKit contributors');
  const emails = new Set();
  for (const person of people) {
    if (typeof person.name !== 'string' || !Array.isArray(person.emails)) continue;
    for (const email of person.emails) {
      if (typeof email === 'string' && /^[^\s@*]+@[^\s@*]+$/.test(email)) emails.add(email.toLowerCase());
    }
  }
  return emails;
}
export function parseOrgPatterns(text) {
  const section = text.split('# BEGIN organizations section.')[1]?.split('# END organizations section.')[0];
  if (!section) return [];
  const patterns = new Set();
  for (const line of section.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^.+ <([^<>\s@]+@[^<>\s@]+)>$/.exec(line.trim());
    if (match && /[*?]/.test(match[1])) patterns.add(match[1].toLowerCase());
  }
  return [...patterns];
}
export function matchesPattern(email, pattern) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i').test(email);
}
export function orgMatches(project, email) {
  const patterns = JSON.parse(getMeta(`${project}_org_patterns`) || '[]');
  return patterns.some(pattern => matchesPattern(email, pattern));
}
export async function refresh(project, fetcher = fetch, minimum = project === 'chromium' ? 1000 : project === 'devtools' ? 100 : 500) {
  if (!SOURCES[project]) throw new Error('Unknown source');
  const response = await fetcher(SOURCES[project], { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${project} fetch failed: ${response.status}`);
  const data = await response.text();
  if (data.length > 5_000_000) throw new Error(`${project} source too large`);
  const emails = project === 'chromium' ? parseAuthors(Buffer.from(data, 'base64').toString('utf8')) : project === 'devtools' ? parseAuthors(data) : parseWebKit(data);
  if (emails.size < minimum) throw new Error(`${project} source has only ${emails.size} individuals`);
  const orgPatterns = project === 'webkit' ? [] : parseOrgPatterns(project === 'chromium' ? Buffer.from(data, 'base64').toString('utf8') : data);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM contributor_sources WHERE project=?').run(project);
    const insert = db.prepare('INSERT INTO contributor_sources VALUES (?,?)');
    for (const email of emails) insert.run(project, email);
    const meta = 'INSERT INTO metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
    db.prepare(meta).run(`${project}_refreshed_at`, String(Date.now()));
    db.prepare(meta).run(`${project}_org_patterns`, JSON.stringify(orgPatterns));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return emails.size;
}
export async function firefoxEligible(email, fetcher = fetch) {
  const cached = db.prepare('SELECT * FROM firefox_lookups WHERE email=? AND expires>?').get(email, Date.now());
  if (cached) return !!cached.eligible;
  const url = new URL('https://api.github.com/search/commits');
  url.searchParams.set('q', `repo:mozilla/gecko-dev author-email:${email}`);
  url.searchParams.set('per_page', '10');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'browser-contributors-map' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firefox commit lookup failed: ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result.items) || result.incomplete_results) throw new Error('Incomplete Firefox commit lookup');
  const eligible = result.items.some(item => item.commit?.author?.email?.toLowerCase() === email);
  db.prepare('INSERT INTO firefox_lookups VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET eligible=excluded.eligible,expires=excluded.expires').run(email, eligible ? 1 : 0, Date.now() + (eligible ? 24 : 1) * 3600_000);
  return eligible;
}
export function sourceReady(project) {
  return project === 'firefox' || Date.now() - Number(getMeta(`${project}_refreshed_at`) || 0) < 72 * 3600_000;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const projects = process.argv[2] ? [process.argv[2]] : Object.keys(SOURCES);
  for (const project of projects) {
    try { console.log(`${project} refreshed: ${await refresh(project)} contributors`); }
    catch (error) { console.error(error); process.exitCode = 1; }
  }
}
