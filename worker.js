import './env.js';
import { refresh, SOURCES } from './refresh.js';
import { getMeta } from './db.js';
async function tick() {
  for (const project of Object.keys(SOURCES)) {
    if (Date.now() - Number(getMeta(`${project}_refreshed_at`) || 0) < 24 * 3600_000) continue;
    try { console.log(`${project} refreshed: ${await refresh(project)} contributors`); }
    catch (error) { console.error(`${project} refresh failed:`, error); }
  }
}
await tick();
setInterval(tick, 5 * 60_000);
