import { useEffect, useRef, useState } from 'react';
import type { World } from '../sim/types';
const W = 48,
  H = 24;
const project = (x: number, y: number) => ({
  x: ((x - y) * W) / 2 + 600,
  y: ((x + y) * H) / 2 + 65,
});
const noise = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
export default function ManorMap({
  world,
  selected,
  onSelect,
}: {
  world: World;
  selected: [number, number];
  onSelect: (p: [number, number]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 630 }),
    [view, setView] = useState({ zoom: 1, x: 0, y: 0 }),
    [hover, setHover] = useState<[number, number] | null>(null),
    [grid, setGrid] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  const fit = Math.min(size.w / 1200, size.h / 720),
    scale = fit * view.zoom;
  useEffect(() => {
    const obs = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    if (wrap.current) obs.observe(wrap.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    const bg = ctx.createLinearGradient(0, 0, size.w, size.h);
    bg.addColorStop(0, '#243e38');
    bg.addColorStop(1, '#142a28');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.translate((size.w - 1200 * scale) / 2 + view.x, (size.h - 720 * scale) / 2 + view.y);
    ctx.scale(scale, scale);
    const poly = (points: number[][], fill: string, stroke?: string) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    };
    const line = (x: number, y: number, xx: number, yy: number, color: string, width = 1) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(xx, yy);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const diamond = (x: number, y: number, color: string) =>
      poly(
        [
          [x, y],
          [x + 24, y + 12],
          [x, y + 24],
          [x - 24, y + 12],
        ],
        color,
        grid ? '#c8d6b833' : undefined,
      );
    const block = (
      x: number,
      y: number,
      w: number,
      d: number,
      h: number,
      top: string,
      left: string,
      right: string,
    ) => {
      poly(
        [
          [x - w, y],
          [x, y + d / 2],
          [x, y + d / 2 - h],
          [x - w, y - h],
        ],
        left,
      );
      poly(
        [
          [x, y + d / 2],
          [x + w, y],
          [x + w, y - h],
          [x, y + d / 2 - h],
        ],
        right,
      );
      poly(
        [
          [x - w, y - h],
          [x, y - d / 2 - h],
          [x + w, y - h],
          [x, y + d / 2 - h],
        ],
        top,
      );
    };
    const house = (x: number, y: number, stone = false) => {
      ctx.fillStyle = '#13292555';
      ctx.beginPath();
      ctx.ellipse(x + 6, y + 9, 24, 10, 0, 0, 7);
      ctx.fill();
      block(
        x,
        y + 6,
        17,
        18,
        stone ? 34 : 20,
        stone ? '#b7b6a0' : '#d9cda5',
        stone ? '#939982' : '#c3b389',
        stone ? '#707f73' : '#9f9675',
      );
      if (stone) {
        block(x - 12, y - 18, 8, 10, 22, '#c8c8ac', '#9a9d88', '#6d7c70');
        block(x + 12, y - 18, 8, 10, 22, '#c8c8ac', '#9a9d88', '#6d7c70');
        for (const xx of [-17, -11, 7, 13])
          block(x + xx, y - 39, 3, 3, 5, '#d0ceb1', '#a3a58d', '#728171');
      } else {
        poly(
          [
            [x - 21, y - 15],
            [x - 3, y - 40],
            [x + 21, y - 28],
            [x + 21, y - 5],
          ],
          '#80634d',
        );
        poly(
          [
            [x - 21, y - 15],
            [x + 2, y - 3],
            [x + 21, y - 28],
            [x - 3, y - 40],
          ],
          '#b78d5c',
        );
        for (let i = 0; i < 6; i++)
          line(x - 18 + i * 3, y - 16 - i * 3, x + 2 + i * 3, y - 5 - i * 3, '#dab57c88');
        block(x + 10, y - 28, 3, 4, 13, '#9f9781', '#7e7c6d', '#626e62');
      }
      poly(
        [
          [x + 5, y - 6],
          [x + 11, y - 9],
          [x + 11, y + 7],
          [x + 5, y + 10],
        ],
        '#384b41',
      );
      line(x - 12, y - 7, x - 6, y - 4, '#564e3e', 3);
    };
    // Raised island edge gives the map a physical board rather than a flat grid.
    const p0 = project(0, 0),
      p1 = project(24, 0),
      p2 = project(24, 24),
      p3 = project(0, 24);
    poly(
      [
        [p3.x, p3.y],
        [p2.x, p2.y],
        [p2.x, p2.y + 18],
        [p3.x, p3.y + 18],
      ],
      '#53634a',
    );
    poly(
      [
        [p1.x, p1.y],
        [p2.x, p2.y],
        [p2.x, p2.y + 18],
        [p1.x, p1.y + 18],
      ],
      '#354f43',
    );
    for (let depth = 0; depth < 48; depth++)
      for (const t of world.tiles.filter((t) => t.x + t.y === depth)) {
        const p = project(t.x, t.y),
          m = t.manor!,
          n = noise(t.x, t.y);
        const base =
          m.kind === 'field'
            ? '#887448'
            : ['road', 'plaza', 'well', 'gate'].includes(m.kind)
              ? '#adab89'
              : n > 0.5
                ? '#7f9560'
                : '#879c66';
        diamond(p.x, p.y, base);
        if (m.kind === 'green') {
          for (let j = 0; j < 4; j++) {
            const ox = (noise(t.x + j, t.y) - 0.5) * 27,
              oy = noise(t.x, t.y + j) * 12;
            line(p.x + ox, p.y + 5 + oy, p.x + ox + 2, p.y + 2 + oy, '#b1be8270');
          }
        }
        if (m.kind === 'road' || m.kind === 'plaza' || m.kind === 'well')
          for (let j = 0; j < 4; j++) {
            const ox = (j % 2) * 13 - 13,
              oy = Math.floor(j / 2) * 6 + 6;
            line(p.x + ox, p.y + oy, p.x + ox + 8, p.y + oy + 4, '#e4d7ac70');
          }
        if (m.kind === 'field') {
          const crop = m.plot!,
            growth = crop.harvest > 0 ? 1 : Math.min(0.8, crop.work / crop.required);
          for (let row = 0; row < 6; row++) {
            const xx = p.x - 17 + row * 6,
              yy = p.y + 9 + row * 2.8;
            line(xx, yy, xx + 15, yy - 7, '#544d31', 1.6);
            if (growth > 0)
              for (let j = 0; j < 4; j++) {
                const fx = xx + j * 4,
                  fy = yy - j * 1.8;
                line(
                  fx,
                  fy,
                  fx,
                  fy - 2 - growth * 6,
                  crop.harvest > 0 ? '#eed38b' : world.manor!.shock ? '#aba260' : '#bfcb79',
                  1.6,
                );
              }
          }
        }
      }
    // Depth-sort scenery and residents together for correct isometric occlusion.
    for (let depth = 0; depth < 48; depth++)
      for (const t of world.tiles.filter((t) => t.x + t.y === depth)) {
        const p = project(t.x, t.y),
          m = t.manor!;
        const manorGranary = t.eco?.structures.some((s) => s.id === 'keep-store');
        if (m.kind === 'house' || (m.kind === 'store' && !manorGranary) || m.kind === 'smithy')
          house(p.x, p.y + 13);
        if (m.kind === 'keep') house(p.x, p.y + 13, true);
        if (m.kind === 'wall') {
          block(p.x, p.y + 12, 24, 24, 21, '#b9bba0', '#8e9781', '#687e70');
          for (const xx of [-18, -6, 6, 18])
            block(p.x + xx, p.y + 8, 4, 5, 25, '#c7c7a9', '#939d84', '#6a8171');
        }
        if (m.kind === 'gate') {
          block(p.x - 15, p.y + 12, 7, 10, 24, '#bbbba0', '#8e9781', '#647a6b');
          block(p.x + 15, p.y + 12, 7, 10, 24, '#bbbba0', '#8e9781', '#647a6b');
          if (m.lock?.locked && m.lock.hp > 0)
            poly(
              [
                [p.x - 9, p.y - 7],
                [p.x + 9, p.y + 2],
                [p.x + 9, p.y + 21],
                [p.x - 9, p.y + 12],
              ],
              '#715c40',
            );
        }
        if (m.kind === 'well') {
          block(p.x, p.y + 14, 10, 10, 9, '#b8b89d', '#929b84', '#6b8477');
          ctx.fillStyle = '#2c5250';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 4, 6, 3, 0, 0, 7);
          ctx.fill();
        }
        if (
          m.kind === 'green' &&
          (t.x < 2 || t.y < 2 || t.x > 21 || t.y > 21) &&
          noise(t.x, t.y) > 0.35
        ) {
          ctx.fillStyle = '#264a3940';
          ctx.beginPath();
          ctx.ellipse(p.x + 8, p.y + 17, 19, 6, 0, 0, 7);
          ctx.fill();
          line(p.x, p.y + 14, p.x, p.y - 11, '#6a6546', 3);
          for (let j = 0; j < 3; j++) {
            ctx.fillStyle = ['#456c48', '#587d50', '#709159'][j];
            ctx.beginPath();
            ctx.ellipse(p.x + (j - 1) * 5, p.y - 10 - j * 5, 12, 15, 0, 0, 7);
            ctx.fill();
          }
        }
        const people = world.agents.filter((a) => !a.away && a.x === t.x && a.y === t.y);
        people.forEach((a, i) => {
          const xx = p.x + ((i % 4) - 1.5) * 7,
            yy = p.y + 12 + Math.floor(i / 4) * 5;
          if (a.death) {
            line(xx - 3, yy - 3, xx + 3, yy + 3, '#513f37', 2);
            line(xx + 3, yy - 3, xx - 3, yy + 3, '#513f37', 2);
            return;
          }
          ctx.fillStyle = '#15342c66';
          ctx.beginPath();
          ctx.ellipse(xx + 2, yy + 2, 4, 2, 0, 0, 7);
          ctx.fill();
          const armored = a.eco!.stock.some((b) => b.item === 'mail');
          ctx.fillStyle = armored
            ? '#778e9a'
            : ['#b05d44', '#d5b878', '#587e89', '#9a826b'][a.id % 4];
          ctx.fillRect(xx - 2.5, yy - 7, 5, 7);
          ctx.fillStyle = '#e9c99a';
          ctx.beginPath();
          ctx.arc(xx, yy - 9, 2.7, 0, 7);
          ctx.fill();
          if (armored) {
            line(xx - 3, yy - 11, xx + 3, yy - 11, '#c6d0c6', 2);
            line(xx + 4, yy - 3, xx + 5, yy - 14, '#e2e0c6');
          }
        });
      }
    for (const [coords, color] of [
      [selected, '#f5d593'],
      [hover, '#f5efcc'],
    ] as const) {
      if (!coords) continue;
      const p = project(...coords);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 24, p.y + 12);
      ctx.lineTo(p.x, p.y + 24);
      ctx.lineTo(p.x - 24, p.y + 12);
      ctx.closePath();
      ctx.stroke();
    }
    for (const [x, y, text] of [
      [9, 10, '集会广场'],
      [18, 5, '鸦溪庄园'],
      [8, 20, '南方田条'],
      [1, 10, '王室大道'],
    ] as [number, number, string][]) {
      const p = project(x, y);
      ctx.font = '600 12px system-ui';
      ctx.textAlign = 'center';
      const width = ctx.measureText(text).width;
      ctx.fillStyle = '#1a3630e8';
      ctx.fillRect(p.x - width / 2 - 9, p.y - 28, width + 18, 24);
      ctx.fillStyle = '#ebdbb0';
      ctx.fillText(text, p.x, p.y - 12);
    }
    ctx.font = 'italic 18px Georgia';
    ctx.fillStyle = '#d5c79b';
    ctx.textAlign = 'center';
    ctx.fillText('R A V E N B R O O K', 600, 35);
  }, [world, size, view, hover, selected, grid, scale]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const r = canvas.current!.getBoundingClientRect();
    const sx = (e.clientX - r.left - (size.w - 1200 * scale) / 2 - view.x) / scale - 600,
      sy = (e.clientY - r.top - (size.h - 720 * scale) / 2 - view.y) / scale - 65;
    const x = Math.floor(sx / W + sy / H),
      y = Math.floor(sy / H - sx / W);
    return x >= 0 && y >= 0 && x < 24 && y < 24 ? [x, y] : null;
  };
  return (
    <div className="manor-map">
      <div className="manor-map-tools">
        <span>
          等距领地图 · {hover ? `坐标 ${hover.join(', ')}` : '拖动平移 · 滚轮缩放 · 点击查看'}
        </span>
        <div>
          <button onClick={() => setGrid(!grid)}>网格</button>
          <button onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>归位</button>
          <button
            aria-label="放大领地"
            onClick={() => setView((v) => ({ ...v, zoom: Math.min(3, v.zoom * 1.25) }))}
          >
            ＋
          </button>
        </div>
      </div>
      <div ref={wrap} className="manor-canvas-wrap">
        <canvas
          ref={canvas}
          aria-label="鸦溪中世纪领地交互地图"
          onWheel={(e) =>
            setView((v) => ({
              ...v,
              zoom: Math.min(3, Math.max(0.7, v.zoom * (e.deltaY < 0 ? 1.1 : 0.9))),
            }))
          }
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) {
              if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
              if (d.moved)
                setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
            } else setHover(point(e));
          }}
          onPointerUp={(e) => {
            if (!drag.current?.moved) {
              const p = point(e);
              if (p) onSelect(p);
            }
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onPointerLeave={() => setHover(null)}
        />
      </div>
    </div>
  );
}
