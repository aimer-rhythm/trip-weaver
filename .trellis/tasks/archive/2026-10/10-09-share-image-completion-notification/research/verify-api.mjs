import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const directory = await mkdtemp(path.join(os.tmpdir(), 'tw-share-notification-pg-'));
const bin = 'C:/Program Files/PostgreSQL/16/bin';
const options = { windowsHide: true, maxBuffer: 8 * 1024 * 1024 };
// pg_ctl 的服务进程会继承管道；以 exit 等待控制器，不等待服务持有的 close。
const control = args => new Promise((resolve, reject) => {
  const child = spawn(path.join(bin, 'pg_ctl.exe'), args, { windowsHide: true, stdio: 'ignore' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`pg_ctl exited ${code}`)));
});
let started = false;
try {
  await run(path.join(bin, 'initdb.exe'), ['-D', directory, '-A', 'trust', '-U', 'postgres', '--no-locale', '-E', 'UTF8'], options);
  console.log('启动隔离 PostgreSQL…');
  await control(['-D', directory, '-l', path.join(directory, 'server.log'), '-o', '-h 127.0.0.1 -p 18834', '-w', 'start']);
  started = true;
  console.log('验证通知与图片 API…');
  const result = await run(process.execPath, ['--import', 'tsx', 'scripts/verify-trip-share-image.mts'], {
    ...options, env: { ...process.env, SHARE_IMAGE_TEST_DATABASE_URL: 'postgres://postgres@127.0.0.1:18834/postgres' },
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  process.stderr.write(error.stdout ?? '');
  process.stderr.write(error.stderr ?? '');
  throw error;
} finally {
  if (started) await control(['-D', directory, '-m', 'fast', '-w', 'stop']);
  console.log(`隔离 PostgreSQL 已停止，诊断目录：${directory}`);
}
