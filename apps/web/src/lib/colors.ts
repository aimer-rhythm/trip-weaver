import { DAY_COLORS, type ActivityCategory } from '@tripweaver/shared';

export function dayColor(dayIndex: number): string {
  return DAY_COLORS[(dayIndex - 1) % DAY_COLORS.length]!;
}

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  美食: '#e76f51',
  文化: '#457b9d',
  自然: '#2a9d8f',
  购物: '#b5838d',
  住宿: '#6d597a',
  交通: '#8d99ae',
  娱乐: '#d9a406',
  其他: '#8a8f98',
};

export function hasValidCoord(a: { lat: number; lng: number }): boolean {
  return Number.isFinite(a.lat) && Number.isFinite(a.lng) && !(a.lat === 0 && a.lng === 0);
}
