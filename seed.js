// Dev-only: fill the local DB with synthetic published profiles from the real
// Chromium AUTHORS roster so map performance can be judged at scale.
import { db } from './db.js';
import { createHash } from 'node:crypto';
import { SOURCES, parseAuthors } from './refresh.js';

const CITIES = [
  ['Vienna, Austria', 48.2, 16.4], ['Berlin, Germany', 52.5, 13.4], ['London, UK', 51.5, -0.1],
  ['Paris, France', 48.9, 2.3], ['Amsterdam, Netherlands', 52.4, 4.9], ['Zurich, Switzerland', 47.4, 8.5],
  ['Prague, Czechia', 50.1, 14.4], ['Warsaw, Poland', 52.2, 21.0], ['Stockholm, Sweden', 59.3, 18.1],
  ['Oslo, Norway', 59.9, 10.7], ['Copenhagen, Denmark', 55.7, 12.6], ['Helsinki, Finland', 60.2, 24.9],
  ['Dublin, Ireland', 53.3, -6.3], ['Barcelona, Spain', 41.4, 2.2], ['Madrid, Spain', 40.4, -3.7],
  ['Lisbon, Portugal', 38.7, -9.1], ['Rome, Italy', 41.9, 12.5], ['Munich, Germany', 48.1, 11.6],
  ['Budapest, Hungary', 47.5, 19.0], ['Bucharest, Romania', 44.4, 26.1], ['Sofia, Bulgaria', 42.7, 23.3],
  ['Zagreb, Croatia', 45.8, 16.0], ['Belgrade, Serbia', 44.8, 20.5], ['Vilnius, Lithuania', 54.7, 25.3],
  ['Riga, Latvia', 56.9, 24.1], ['Tallinn, Estonia', 59.4, 24.8], ['Kyiv, Ukraine', 50.4, 30.5],
  ['Moscow, Russia', 55.8, 37.6], ['Istanbul, Türkiye', 41.0, 29.0], ['Tel Aviv, Israel', 32.1, 34.8],
  ['Dubai, UAE', 25.2, 55.3], ['Riyadh, Saudi Arabia', 24.7, 46.7], ['Bengaluru, India', 13.0, 77.6],
  ['Hyderabad, India', 17.4, 78.5], ['Chennai, India', 13.1, 80.2], ['Pune, India', 18.5, 73.9],
  ['Mumbai, India', 19.1, 72.9], ['Delhi, India', 28.6, 77.2], ['Kolkata, India', 22.6, 88.4],
  ['Karachi, Pakistan', 24.9, 67.0], ['Dhaka, Bangladesh', 23.8, 90.4], ['Colombo, Sri Lanka', 6.9, 79.9],
  ['Singapore', 1.35, 103.8], ['Kuala Lumpur, Malaysia', 3.1, 101.7], ['Bangkok, Thailand', 13.8, 100.5],
  ['Jakarta, Indonesia', -6.2, 106.8], ['Manila, Philippines', 14.6, 121.0], ['Hanoi, Vietnam', 21.0, 105.8],
  ['Taipei, Taiwan', 25.0, 121.5], ['Seoul, South Korea', 37.6, 127.0], ['Tokyo, Japan', 35.7, 139.7],
  ['Osaka, Japan', 34.7, 135.5], ['Sydney, Australia', -33.9, 151.2], ['Melbourne, Australia', -37.8, 145.0],
  ['Auckland, New Zealand', -36.8, 174.8], ['Honolulu, USA', 21.3, -157.9], ['Anchorage, USA', 61.2, -149.9],
  ['Vancouver, Canada', 49.3, -123.1], ['Seattle, USA', 47.6, -122.3], ['San Francisco, USA', 37.8, -122.4],
  ['Portland, USA', 45.5, -122.7], ['Los Angeles, USA', 34.1, -118.2], ['Denver, USA', 39.7, -105.0],
  ['Austin, USA', 30.3, -97.7], ['Chicago, USA', 41.9, -87.6], ['Toronto, Canada', 43.7, -79.4],
  ['Boston, USA', 42.4, -71.1], ['New York, USA', 40.7, -74.0], ['Atlanta, USA', 33.7, -84.4],
  ['Miami, USA', 25.8, -80.2], ['Mexico City, Mexico', 19.4, -99.1], ['Bogotá, Colombia', 4.7, -74.1],
  ['Lima, Peru', -12.0, -77.0], ['Santiago, Chile', -33.4, -70.7], ['Buenos Aires, Argentina', -34.6, -58.4],
  ['São Paulo, Brazil', -23.6, -46.6], ['Rio de Janeiro, Brazil', -22.9, -43.2], ['Cape Town, South Africa', -33.9, 18.4],
  ['Johannesburg, South Africa', -26.2, 28.0], ['Nairobi, Kenya', -1.3, 36.8], ['Lagos, Nigeria', 6.5, 3.4],
  ['Cairo, Egypt', 30.0, 31.2], ['Casablanca, Morocco', 33.6, -7.6], ['Montreal, Canada', 45.5, -73.6]
];
const STATUSES = ['Just browsing', 'Open to meetups', 'Open to mentoring'];
const INTERESTS = ['Blink', 'V8', 'graphics', 'accessibility', 'privacy', 'networking', 'webgpu', 'css', 'devtools', 'media', 'security', 'extensions', 'PWA', 'i18n', 'testing', 'performance'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const nameFromEmail = email => {
  const local = email.split('@')[0].replace(/[._\-\d]+/g, ' ').trim();
  return (local.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Contributor').slice(0, 80);
};

const response = await fetch(SOURCES.chromium, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`AUTHORS fetch failed: ${response.status}`);
const text = Buffer.from(await response.text(), 'base64').toString('utf8');
const section = text.split('# BEGIN individuals section.')[1]?.split('# END individuals section.')[0] ?? '';
const names = new Map();
for (const line of section.split('\n')) {
  const m = /^(.+) <([^<>\s@]+@[^<>\s@]+)>$/.exec(line.trim());
  if (m) names.set(m[2].toLowerCase(), m[1].trim().slice(0, 80));
}
const emails = [...parseAuthors(text)];
const limit = Number(process.argv[2] || emails.length);
const insert = db.prepare(`INSERT INTO profiles (email,name,place,lat,lng,status,interests,bio,website,published,updated_at,projects,gravatar)
  VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,place=excluded.place,lat=excluded.lat,lng=excluded.lng,status=excluded.status,interests=excluded.interests,published=1,updated_at=excluded.updated_at,projects=excluded.projects,gravatar=excluded.gravatar`);
db.exec('BEGIN');
for (const email of emails.slice(0, limit)) {
  const [place, lat, lng] = pick(CITIES);
  const jitter = () => (Math.random() - 0.5) * 0.08; // keep synthetic markers from stacking exactly
  insert.run(email, names.get(email) || nameFromEmail(email), place, lat + jitter(), lng + jitter(), pick(STATUSES),
    Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => pick(INTERESTS)).join(', '), '', '', Date.now(), JSON.stringify(['chromium']),
    createHash('md5').update(email).digest('hex'));
}
db.exec('COMMIT');
console.log(`Seeded ${Math.min(limit, emails.length)} synthetic profiles across ${CITIES.length} cities. Remove with: sqlite3 data/map.sqlite "DELETE FROM profiles WHERE bio=''"`);
