// 离线精选图库优先于自动召回：审核、身份、许可和本地文件均成立才提供封面。
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhotoAttributionSchema, type ResearchPoi } from '@tripweaver/shared';
import hangzhou from '../data/photography/hangzhou-curated.json';
import beijing from '../data/photography/beijing-curated.json';

const PhotoSchema = Type.Object({
  id: Type.String({ pattern: '^(pexels|commons)-[0-9]+$' }),
  key: Type.String({ pattern: '^photography/(pexels|commons)-[0-9]+\\.webp$' }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  attribution: PhotoAttributionSchema,
  review: Type.Object({
    status: Type.Union([Type.Literal('approved'), Type.Literal('pending'), Type.Literal('rejected')]),
    identity: Type.Union([Type.Literal('verified'), Type.Literal('uncertain')]),
    reviewer: Type.String({ minLength: 1 }),
    reviewedAt: Type.String({ minLength: 10 }),
    evidence: Type.String({ minLength: 10 }),
    quality: Type.String({ minLength: 5 }),
  }),
});
const LibrarySchema = Type.Object({
  version: Type.Literal(1), city: Type.String({ minLength: 1 }),
  places: Type.Array(Type.Object({
    name: Type.String({ minLength: 1 }), aliases: Type.Array(Type.String({ minLength: 1 })),
    photos: Type.Array(PhotoSchema, { maxItems: 5 }),
  })),
});
export type CuratedPhoto = Static<typeof PhotoSchema>;
export type CuratedLibrary = Static<typeof LibrarySchema>;
export type CuratedCover = Required<Pick<ResearchPoi, 'coverUrl' | 'coverAttribution' | 'photos'>>;
const mediaRoot = fileURLToPath(new URL('../../../../data/media/', import.meta.url));

function allowedAttribution(photo: CuratedPhoto): boolean {
  const { source, sourceUrl, license, licenseUrl } = photo.attribution;
  // 本地精选目录当前只收Pexels/Commons；扩展共享署名枚举不能放宽这里的图源协议。
  if (source !== 'pexels' && source !== 'commons') return false;
  try {
    const page = new URL(sourceUrl); const terms = new URL(licenseUrl);
    if ([page, terms].some(url => url.protocol !== 'https:' || url.username || url.password || url.port)) return false;
    if (!photo.id.startsWith(source === 'pexels' ? 'pexels-' : 'commons-') || photo.key !== `photography/${photo.id}.webp`) return false;
    if (source === 'pexels') return page.hostname === 'www.pexels.com' && license === 'Pexels License' && terms.href === 'https://www.pexels.com/license/';
    if (page.hostname !== 'commons.wikimedia.org' || !page.pathname.startsWith('/wiki/File:') || terms.hostname !== 'creativecommons.org') return false;
    const cc = license.match(/^CC (BY(?:-SA)?) ([234]\.0)$/);
    if (cc) return terms.pathname.replace(/\/$/, '') === `/licenses/${cc[1]!.toLowerCase()}/${cc[2]}`;
    return license === 'CC0' && /^\/publicdomain\/zero\/1\.0(?:\/deed\.[a-z-]+)?\/?$/.test(terms.pathname);
  } catch { return false; }
}

/** 精确主名/显式别名，禁止剥掉“湖/寺”等尾缀模糊挪用其他景点。 */
function key(name: string): string { return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase(); }
export function findCuratedPhotos(library: unknown, city: string, name: string): CuratedPhoto[] {
  if (!Value.Check(LibrarySchema, library) || key(city) !== key(library.city)) return [];
  const wanted = key(name);
  const primary = wanted.match(/^([^()]+)\([^()]+\)$/)?.[1];
  const find = (match: string) => library.places.filter(place => [place.name, ...place.aliases].some(n => key(n) === match));
  const exact = find(wanted);
  const matches = exact.length ? exact : primary ? find(primary) : [];
  // 冲突的主名/别名不得随机选第一条。
  if (matches.length !== 1) return [];
  return matches[0]!.photos.filter(p => p.review.status === 'approved' && p.review.identity === 'verified' && allowedAttribution(p));
}

export function createCuratedCoverLookup(
  city: string,
  options: { library?: unknown; mediaBase?: string; verify?: (photo: CuratedPhoto) => Promise<boolean> } = {},
): (name: string) => Promise<CuratedCover | null> {
  const library = options.library ?? (key(city) === '北京' ? beijing : hangzhou);
  const base = (options.mediaBase ?? '/media').replace(/\/+$/, '');
  const verify = options.verify ?? (async (photo: CuratedPhoto) => {
    const file = path.join(mediaRoot, photo.key);
    const info = await stat(file);
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return false;
    const bytes = await readFile(file);
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' &&
      createHash('sha256').update(bytes).digest('hex') === photo.sha256;
  });
  const pending = new Map<string, Promise<CuratedCover | null>>();
  return (name: string) => {
    const cacheKey = key(name);
    let value = pending.get(cacheKey);
    if (!value) {
      value = (async () => {
        const photos: CuratedCover['photos'] = [];
        for (const photo of findCuratedPhotos(library, city, name)) {
          const url = `${base}/${photo.key}`;
          if (photos.some(entry => entry.url === url)) continue;
          try {
            if (await verify(photo)) photos.push({ url, attribution: photo.attribution });
          } catch { /* 缺文件或不可读不影响下一候选和原有兜底。 */ }
          if (photos.length === 3) break;
        }
        const first = photos[0];
        return first?.attribution ? { coverUrl: first.url, coverAttribution: first.attribution, photos } : null;
      })();
      pending.set(cacheKey, value);
    }
    return value;
  };
}
