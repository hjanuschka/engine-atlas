import './env.js';
import { spawn } from 'node:child_process';

const env = { PORT: process.env.PORT || '4317', HOST: '127.0.0.1', MAIL_MODE: 'local', DEV_MAGIC_LINKS: '1', ...process.env };
const children = [spawn(process.execPath, ['worker.js'], { env, stdio: 'inherit' }), spawn(process.execPath, ['--watch', 'server.js'], { env, stdio: 'inherit' })];
function stop() { for (const child of children) child.kill(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children[1].on('exit', code => { stop(); process.exitCode = code || 0; });
