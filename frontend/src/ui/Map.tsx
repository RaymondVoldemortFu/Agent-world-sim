import { useRef, useEffect, useState } from 'react';
import type { World } from '../sim/types';
const colors = {
  plain: ['#263d2c', '#2a422f', '#304833'],
  hill: ['#454c35', '#4c5139', '#51583d'],
  mountain: ['#5a5d52', '#626558', '#6c6e60'],
};
export default function Map({
  world,
  selected,
  onSelect,
  layer,
  focus,
}: {
  world: World;
  selected: [number, number] | null;
  onSelect: (p: [number, number]) => void;
  layer: string;
  focus?: [number, number];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  useEffect(() => {
    const o = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    if (box.current) o.observe(box.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (focus)
      setView({
        zoom: 2.4,
        x:
          (((world.config.size / 2 - focus[0] - 0.5) * Math.min(size.width, size.height)) /
            world.config.size) *
          2.4,
        y:
          (((world.config.size / 2 - focus[1] - 0.5) * Math.min(size.width, size.height)) /
            world.config.size) *
          2.4,
      });
  }, [focus, size.width, size.height, world.config.size]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2,
        y = e.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const next = Math.max(0.8, Math.min(6, v.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
        return {
          zoom: next,
          x: x - ((x - v.x) * next) / v.zoom,
          y: y - ((y - v.y) * next) / v.zoom,
        };
      });
    };
    element.addEventListener('wheel', zoom, { passive: false });
    return () => element.removeEventListener('wheel', zoom);
  }, []);
  const unit = (Math.min(size.width, size.height) / world.config.size) * view.zoom;
  const ox = (size.width - world.config.size * unit) / 2 + view.x,
    oy = (size.height - world.config.size * unit) / 2 + view.y;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.width * dpr;
    c.height = size.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = '#151f19';
    ctx.fillRect(0, 0, size.width, size.height);
    for (const t of world.tiles) {
      const x = ox + t.x * unit,
        y = oy + t.y * unit;
      if (x + unit < 0 || y + unit < 0 || x > size.width || y > size.height) continue;
      let fill = colors[t.terrain][(t.x * 7 + t.y * 3) % 3];
      if (layer === 'food') {
        const food = t.farm >= 3 ? t.farmFood : (t.resources.food ?? 0);
        fill = `hsl(${35 + food * 6} 30% ${16 + food * 2}%)`;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, unit + 0.5, unit + 0.5);
      if (unit > 7) {
        ctx.strokeStyle = 'rgba(13,25,17,.14)';
        ctx.strokeRect(x, y, unit, unit);
      }
      if (t.terrain === 'mountain' && unit > 7) {
        ctx.fillStyle = 'rgba(179,183,154,.22)';
        ctx.beginPath();
        ctx.moveTo(x + unit * 0.18, y + unit * 0.8);
        ctx.lineTo(x + unit * 0.53, y + unit * 0.2);
        ctx.lineTo(x + unit * 0.85, y + unit * 0.8);
        ctx.fill();
      }
      if (t.terrain === 'plain' && (t.resources.wood ?? 0) > 0 && unit > 9) {
        ctx.fillStyle = 'rgba(129,157,92,.2)';
        ctx.fillRect(x + unit * 0.2, y + unit * 0.3, unit * 0.18, unit * 0.38);
      }
      if (t.farm) {
        ctx.fillStyle = t.farm >= 3 ? '#c3a65b' : '#78643a';
        ctx.fillRect(x + 2, y + 2, unit - 4, unit - 4);
        ctx.strokeStyle = '#665a35';
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(x + (unit * i) / 4, y + 2);
          ctx.lineTo(x + (unit * i) / 4, y + unit - 2);
          ctx.stroke();
        }
      }
      if (t.shelter) {
        ctx.fillStyle = t.shelter.complete ? '#ddcfaa' : '#9d8f71';
        ctx.beginPath();
        ctx.moveTo(x + unit * 0.15, y + unit * 0.5);
        ctx.lineTo(x + unit * 0.5, y + unit * 0.15);
        ctx.lineTo(x + unit * 0.85, y + unit * 0.5);
        ctx.lineTo(x + unit * 0.8, y + unit * 0.85);
        ctx.lineTo(x + unit * 0.2, y + unit * 0.85);
        ctx.fill();
      }
      if (Object.keys(t.ground).length) {
        ctx.fillStyle = '#e0bc73';
        ctx.fillRect(
          x + unit * 0.7,
          y + unit * 0.7,
          Math.max(2, unit * 0.2),
          Math.max(2, unit * 0.2),
        );
      }
    }
    const groups = new globalThis.Map<string, typeof world.agents>();
    for (const a of world.agents.filter((a) => !a.death)) {
      const k = `${a.x},${a.y}`;
      groups.set(k, [...(groups.get(k) ?? []), a]);
    }
    for (const group of groups.values()) {
      const a = group[0],
        x = ox + (a.x + 0.5) * unit,
        y = oy + (a.y + 0.5) * unit;
      ctx.shadowColor = '#0008';
      ctx.shadowBlur = 5;
      ctx.fillStyle =
        a.hunger <= 20 ? '#ea9377' : a.age < world.config.adultAge ? '#c3a6e4' : '#e8d5a0';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, unit * 0.31), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#233226';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (unit > 17 || group.length > 1) {
        ctx.fillStyle = '#15231a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.max(9, unit * 0.4)}px monospace`;
        ctx.fillText(group.length > 1 ? String(group.length) : String(a.id), x, y);
      }
    }
    if (selected) {
      ctx.strokeStyle = '#f4e4b6';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + selected[0] * unit, oy + selected[1] * unit, unit, unit);
      ctx.fillStyle = 'rgba(244,228,182,.13)';
      ctx.fillRect(ox + selected[0] * unit, oy + selected[1] * unit, unit, unit);
    }
  }, [world, size, view, selected, layer]);
  return (
    <div className="map-canvas" ref={box}>
      <canvas
        ref={canvas}
        aria-label="世界地图，可拖动、缩放和选择地块"
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const d = drag.current;
            if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 5) d.moved = true;
            if (d.moved)
              setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }
        }}
        onPointerUp={(e) => {
          if (drag.current && !drag.current.moved) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left - ox) / unit),
              y = Math.floor((e.clientY - rect.top - oy) / unit);
            if (x >= 0 && y >= 0 && x < world.config.size && y < world.config.size)
              onSelect([x, y]);
          }
          drag.current = null;
        }}
      />
      <div className="map-coordinate">
        {world.config.size} × {world.config.size} <span>·</span> WORLD SEED {world.config.seed}
      </div>
      <div className="map-navigation">
        <button
          title="放大"
          onClick={() => setView((v) => ({ ...v, zoom: Math.min(6, v.zoom * 1.3) }))}
        >
          ＋
        </button>
        <button
          title="缩小"
          onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.8, v.zoom / 1.3) }))}
        >
          −
        </button>
        <button title="复位地图" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
          ⌖
        </button>
      </div>
    </div>
  );
}
