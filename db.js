import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.DATA_DIR || './data';
mkdirSync(dir, { recursive: true });
export const db = new DatabaseSync(join(dir, 'map.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (
 email TEXT PRIMARY KEY, name TEXT NOT NULL, place TEXT NOT NULL,
 lat REAL NOT NULL, lng REAL NOT NULL, status TEXT NOT NULL,
 interests TEXT NOT NULL, bio TEXT NOT NULL, website TEXT NOT NULL,
 published INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL, projects TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL, projects TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contributor_sources (project TEXT NOT NULL, email TEXT NOT NULL, PRIMARY KEY(project,email));
CREATE TABLE IF NOT EXISTS firefox_lookups (email TEXT PRIMARY KEY, eligible INTEGER NOT NULL, expires INTEGER NOT NULL);`);
if (!db.prepare("PRAGMA table_info(profiles)").all().some(column => column.name === 'projects')) db.exec("ALTER TABLE profiles ADD COLUMN projects TEXT NOT NULL DEFAULT '[\"chromium\"]'");
if (!db.prepare("PRAGMA table_info(profiles)").all().some(column => column.name === 'gravatar')) db.exec("ALTER TABLE profiles ADD COLUMN gravatar TEXT NOT NULL DEFAULT ''");
if (!db.prepare("PRAGMA table_info(profiles)").all().some(column => column.name === 'affiliation')) db.exec("ALTER TABLE profiles ADD COLUMN affiliation TEXT NOT NULL DEFAULT ''");
if (!db.prepare("PRAGMA table_info(profiles)").all().some(column => column.name === 'company')) db.exec("ALTER TABLE profiles ADD COLUMN company TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE profiles SET gravatar='' WHERE gravatar IS NULL");
for (const { email } of db.prepare("SELECT email FROM profiles WHERE gravatar=''").all())
  db.prepare("UPDATE profiles SET gravatar=? WHERE email=?").run(createHash('md5').update(email.trim().toLowerCase()).digest('hex'), email);
for (const table of ['tokens', 'sessions']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'projects')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN projects TEXT NOT NULL DEFAULT '[]'`);
    db.exec(`DELETE FROM ${table}`);
  }
}
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='authors'").get()) {
  db.exec("INSERT OR IGNORE INTO contributor_sources SELECT 'chromium', email FROM authors");
  db.exec("INSERT OR IGNORE INTO metadata SELECT 'chromium_refreshed_at', value FROM metadata WHERE key='refreshed_at'");
  db.exec('DROP TABLE authors');
}
export const getMeta = key => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
