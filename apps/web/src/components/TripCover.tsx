import { useState } from 'react';

// Only files supplied locally are included; unknown destinations never request a guessed URL.
const landmarks = import.meta.glob<string>('../assets/city-landmarks/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function TripCover({ destination, daysCount }: { destination: string; daysCount: number }) {
  const city = destination.trim().replace(/市$/, '');
  const landmark = landmarks[`../assets/city-landmarks/${city}.svg`]
    ?? landmarks[`../assets/city-landmarks/${city}.png`]
    ?? landmarks[`../assets/city-landmarks/${city}.webp`];
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const hasIllustration = Boolean(landmark && loadedUrl === landmark);

  return (
    <div
      className="collection-cover relative isolate flex min-h-[280px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-[15px] bg-[linear-gradient(125deg,var(--cover-a),var(--cover-b))] px-5 py-[60px] pl-7 text-[color:var(--cover-ink)] shadow-[inset_0_1px_0_var(--color-cover-highlight),inset_0_-1px_0_var(--color-cover-edge),2px_1px_3px_var(--color-collection-cover-box-shadow-141)] data-[illustrated=true]:gap-3 data-[illustrated=true]:pb-7 max-[600px]:min-h-[250px] max-[600px]:px-3 max-[600px]:pl-6 max-[600px]:data-[illustrated=true]:gap-2"
      data-illustrated={hasIllustration}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 rounded-l-[15px] bg-[linear-gradient(90deg,color-mix(in_srgb,currentColor_12%,transparent)_0%,var(--color-cover-highlight)_20%,transparent_40%,color-mix(in_srgb,currentColor_18%,transparent)_64%,color-mix(in_srgb,currentColor_7%,transparent)_80%,transparent_100%)]" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-9 left-[2px] w-[15px] before:absolute before:inset-x-0 before:top-0 before:h-1 before:rounded-sm before:bg-[var(--color-cover-binding)] before:shadow-[0_1px_1px_var(--color-cover-edge),inset_0_1px_0_var(--color-cover-highlight)] before:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:rounded-sm after:bg-[var(--color-cover-binding)] after:shadow-[0_1px_1px_var(--color-cover-edge),inset_0_1px_0_var(--color-cover-highlight)] after:content-['']" />
      <span className="collection-destination relative z-[1] text-center [font:400_clamp(28px,2.6vw,48px)/1.25_'QianTuBiFeng_Handwriting','Noto_Serif_SC_Variable',serif] tracking-[3px] [overflow-wrap:anywhere] max-[600px]:text-[30px]">
        {destination}
      </span>
      {landmark && <>
        <img
          key={landmark}
          src={landmark}
          alt=""
          aria-hidden="true"
          className="hidden"
          onLoad={() => setLoadedUrl(landmark)}
          onError={() => setLoadedUrl(undefined)}
        />
        {hasIllustration && <span
          aria-hidden="true"
          className="collection-landmark block h-28 w-full max-w-[152px] shrink-0 bg-current opacity-60 [mask-mode:alpha] [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat] max-[600px]:h-24"
          style={{ maskImage: `url(${JSON.stringify(landmark)})` }}
        />}
      </>}
      <span className="collection-duration absolute right-[15px] top-[15px] rounded-full bg-[var(--color-collection-duration-background-162)] px-[9px] py-1 text-xs">
        {daysCount} 天
      </span>
    </div>
  );
}
