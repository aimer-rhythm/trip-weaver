import { useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../ui/Button';
import { ChinaMap, type MapCityDot } from './ChinaMap';
import { DestinationImage, DestinationShowcase, destinationDescription } from './DestinationShowcase';
import { PinIcon } from './HomeIcons';
import { NavigationIcon } from '../NavigationIcon';

export function DestinationPicker({ cities, mapCities, contextCities, selected, notice, onConfirm, onClose }: {
  cities: string[]; mapCities: MapCityDot[]; contextCities: MapCityDot[]; selected: string | null;
  notice: string | null;
  onConfirm: (city: string) => void; onClose: () => void;
}) {
  const [draftCity, setCandidate] = useState(selected);
  const candidate = draftCity && cities.includes(draftCity) ? draftCity : null;
  return <Modal size="screen" title="选择目的地" onClose={onClose}>
    <div className="mx-auto max-w-2xl [--ui:1px]">
      {notice ? <p role="status" className="my-8 text-center text-sm leading-6 text-ink-muted">{notice}</p>
        : <ChinaMap cities={mapCities} contextCities={contextCities} selected={candidate} onSelect={setCandidate} mode="picker" />}
      <div className="mt-2 rounded-t-[28px] rounded-b-2xl bg-white/85 p-4 shadow-[0_-8px_40px_rgba(31,64,124,0.04)]">
        <div className="mx-auto mb-5 h-1 w-8 rounded-full bg-brand/15" aria-hidden="true" />
        {candidate ? <div className="mb-5 flex items-center gap-3">
          <DestinationImage key={candidate} city={candidate} className="h-16 w-16 shrink-0 rounded-xl" />
          <div className="min-w-0"><h3 className="m-0 flex items-center gap-1 text-lg font-semibold text-ink"><PinIcon className="h-5 w-5 text-brand" />{candidate}</h3><p className="mb-0 mt-1 text-xs leading-5 text-ink-muted">{destinationDescription(candidate)}</p></div>
        </div> : <p className="mb-5 mt-0 text-sm leading-6 text-ink-muted">点击地图或下方城市，选择这次想去的地方。</p>}
        <Button variant="plain" disabled={!candidate || Boolean(notice)} onClick={() => { if (candidate && !notice) onConfirm(candidate); }} className="relative flex min-h-14 w-full items-center justify-center rounded-full bg-gradient-to-r from-brand-sky to-brand px-12 text-base font-semibold text-white disabled:opacity-45">
          确认目的地<span className="absolute right-2 grid h-10 w-10 place-items-center rounded-full bg-white text-brand"><NavigationIcon name="arrow" /></span>
        </Button>
        <div className="mt-5"><DestinationShowcase cities={cities} selected={candidate} onSelect={setCandidate} /></div>
        <details className="mt-4 text-sm text-ink-muted">
          <summary className="cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-brand">全部可规划城市 · {cities.length}</summary>
          <div className="grid grid-cols-3 gap-2 pb-2">{cities.map(city => <Button variant="plain" key={city} aria-pressed={candidate === city} onClick={() => setCandidate(city)} className={`min-h-11 rounded-xl px-2 ${candidate === city ? 'bg-brand/10 text-brand' : 'bg-canvas text-ink'}`}>{city}</Button>)}</div>
        </details>
      </div>
    </div>
  </Modal>;
}
