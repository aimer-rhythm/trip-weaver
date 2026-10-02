// 本机迁移已有摄影视觉配置；不打印、不提交密钥，不覆盖已配置的审图值。
import fs from 'node:fs/promises';
import { parse } from 'dotenv';
const upstream = parse(await fs.readFile('D:/Project/xhs-travel-pipeline/.env'));
const target = 'apps/server/.env';
const raw = await fs.readFile(target, 'utf8'), current = parse(raw);
const mapping = { PHOTO_REVIEW_BASE_URL: 'VISION_BASE_URL', PHOTO_REVIEW_API_KEY: 'VISION_API_KEY', PHOTO_REVIEW_MODEL: 'VISION_MODEL' };
const lines = [];
for (const [dest, src] of Object.entries(mapping)) {
  if (current[dest]) continue;
  const value = upstream[src];
  if (!value || /[\r\n"\\]/.test(value)) throw new Error('视觉配置缺失或需手工编码');
  lines.push(`${dest}="${value}"`);
}
if (lines.length) await fs.writeFile(target, `${raw.trimEnd()}\n\n# 后台选图视觉审核\n${lines.join('\n')}\n`);
console.log(`已配置 ${lines.length} 个后台视觉字段；未显示凭据`);
