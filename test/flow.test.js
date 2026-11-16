import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const dir = await mkdtemp(join(tmpdir(), 'chromium-map-'));
const port = 32000 + Math.floor(Math.random() * 20000);
const origin = `http://localhost:${port}`;
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), SITE_URL: origin, MAIL_MODE: 'local', DEV_MAGIC_LINKS: '1', DATA_DIR: dir }, stdio: 'ignore' });
test('verification flow', async t => {
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const db = new DatabaseSync(join(dir, 'map.sqlite'));
  db.prepare('INSERT INTO contributor_sources VALUES (?,?)').run('chromium', 'contributor@example.com');
  db.prepare('INSERT INTO contributor_sources VALUES (?,?)').run('webkit', 'contributor@example.com');
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('chromium_refreshed_at', String(Date.now()));
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('webkit_refreshed_at', String(Date.now()));
  db.prepare('INSERT INTO firefox_lookups VALUES (?,?,?)').run('contributor@example.com', 1, Date.now() + 3600_000);
  db.prepare('INSERT INTO firefox_lookups VALUES (?,?,?)').run('stranger@example.com', 0, Date.now() + 3600_000);
  const post = async (path, data, csrf, cookie) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
  await t.test('ineligible addresses receive generic response without mail', async () => {
    const result = await post('/api/request', { email: 'stranger@example.com' });
    assert.equal((await result.json()).message, 'If this address is eligible, check your inbox.');
    assert.equal((await readdir(join(dir, 'mail')).catch(() => [])).length, 0);
  });
  await t.test('verification, scoped editing and public visibility', async () => {
    const request = await post('/api/request', { email: 'contributor@example.com' });
    assert.equal(request.status, 200);
    const mail = await readFile(join(dir, 'mail', (await readdir(join(dir, 'mail')))[0]), 'utf8');
    const token = new URL(mail.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
    const inbox = await (await fetch(`${origin}/magic-links`)).text();
    assert.match(inbox, /contributor@example.com/);
    assert.match(inbox, /Open verification link/);
    assert.equal((await fetch(`${origin}/verify?token=${token}`)).status, 200);
    const redeem = await post('/api/redeem', { token });
    assert.equal(redeem.status, 200);
    const cookie = redeem.headers.get('set-cookie').split(';')[0];
    const { csrf } = await redeem.json();
    assert.equal((await post('/api/redeem', { token })).status, 400);
    const profile = { name: 'A person', place: 'Vienna, Austria', lat: 48.21, lng: 16.37, status: 'Open to meetups', interests: 'Blink', bio: '', website: '', published: true, affiliation: 'corporate', company: 'Google' };
    assert.equal((await post('/api/profile', profile, null, cookie)).status, 403);
    const missingLocation = await post('/api/profile', { ...profile, lat: '', lng: '' }, csrf, cookie);
    assert.equal(missingLocation.status, 400);
    assert.match((await missingLocation.json()).error, /Choose your city/);
    assert.equal((await post('/api/profile', { ...profile, company: '' }, csrf, cookie)).status, 400);
    assert.equal((await post('/api/profile', { ...profile, affiliation: 'wizard' }, csrf, cookie)).status, 400);
    assert.equal((await post('/api/profile', profile, csrf, cookie)).status, 200);
    const publicProfiles = await (await fetch(origin + '/api/profiles')).json();
    assert.equal(publicProfiles.length, 1);
    assert.equal(publicProfiles[0].lat, 48.2);
    assert.equal(JSON.stringify(publicProfiles).includes('contributor@example.com'), false);
    assert.deepEqual(publicProfiles[0].projects, ['chromium', 'webkit', 'firefox']);
    assert.equal(publicProfiles[0].company, 'Google');
    await post('/api/hide', {}, csrf, cookie);
    assert.deepEqual(await (await fetch(origin + '/api/profiles')).json(), []);
  });
} finally {
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
  await rm(dir, { recursive: true, force: true });
}
});
