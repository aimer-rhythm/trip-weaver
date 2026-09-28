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

/** Change at most one slot per tick; keep the others stable while a newer target arrives. */
export function advanceGenerationCards(current: ResearchPoi[], target: ResearchPoi[]): ResearchPoi[] {
  const incoming = target.find(poi => !current.some(shown => shown.id === poi.id && shown.coverUrl === poi.coverUrl));
  const staleIndex = current.findIndex(poi => !target.some(wanted => wanted.id === poi.id && wanted.coverUrl === poi.coverUrl));
  if (incoming) {
    if (staleIndex >= 0) return current.map((poi, i) => i === staleIndex ? incoming : poi);
    return [...current, incoming];
  }
  if (staleIndex >= 0) return current.filter((_, i) => i !== staleIndex);
  return current;
}
