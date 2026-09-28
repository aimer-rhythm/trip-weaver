import type { ResearchPoi } from '@tripweaver/shared';

/** Keep recent usable photos ahead of empty/failed covers without discarding candidate data. */
export function selectGenerationCards(pois: readonly ResearchPoi[], failedUrls: ReadonlySet<string>, limit = 5): ResearchPoi[] {
  const withPhoto = pois.filter(poi => poi.coverUrl && !failedUrls.has(poi.coverUrl));
  const selected = withPhoto.slice(-limit);
  if (selected.length < limit) {
    const withoutPhoto = pois.filter(poi => !poi.coverUrl || failedUrls.has(poi.coverUrl));
    selected.push(...withoutPhoto.slice(-(limit - selected.length)));
  }
  const ids = new Set(selected.map(poi => poi.id));
  return pois.filter(poi => ids.has(poi.id));
}

/** Use the actual research introduction, never invent a location-specific caption. */
export function generationCardCaption(poi: ResearchPoi): string {
  const detail = poi.intro?.split(/[。！？；，\n]/u)[0]?.trim();
  return detail ? `${poi.name} · ${detail}` : poi.name;
}
