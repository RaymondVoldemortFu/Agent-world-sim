import { memo, useId, useMemo, useRef, useState } from 'react';
import type { World, Tile } from '../sim/types';
import { settlements, BEAST_NAMES } from '../ecology/wildlife';
import { ITEMS, BUILDINGS } from '../ecology/catalog';
import type { Biome, Season } from '../ecology/types';
const NAMES: Record<Biome, string> = {
  forest: '林地',
  meadow: '草甸',
  wetland: '湿地',
  floodplain: '河漫滩',
  hill: '丘陵',
  water: '水域',
};
const noise = (x: number, y: number, n: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
const TILE = 60;
function Tree({
  x,
  y,
  s,
  autumn,
  winter,
  variant,
}: {
  x: number;
  y: number;
  s: number;
  autumn: boolean;
  winter: boolean;
  variant: number;
}) {
  const leaf = winter
    ? '#b1b6a2'
    : autumn
      ? ['#a39a52', '#ba985b', '#7f9152'][variant % 3]
      : ['#6d8956', '#7b955e', '#557650'][variant % 3];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="3" cy="8" rx="11" ry="4" fill="#253c30" opacity=".25" />
      <path d="M0 8V-8M0 1L-5-4M0-2L5-7" stroke="#594c37" strokeWidth="2" />
      <path
        d="M-10 0C-16-5-10-13-6-13C-9-20 2-24 6-18C13-20 18-12 12-7C19 1 9 7 4 4C-1 10-8 5-10 0Z"
        fill="#385c43"
      />
      <path
        d="M-10-4C-13-11-5-15-2-14C-5-21 6-23 8-16C15-16 17-7 10-5C12 1 2 5-2 1C-8 5-14 0-10-4Z"
        fill={leaf}
      />
      <path
        d="M-6-12Q-1-16 3-14M4-5Q8-9 10-7"
        stroke={winter ? '#e0e1ce' : '#b9bd76'}
        strokeOpacity=".45"
        strokeWidth="1.3"
        fill="none"
      />
    </g>
  );
}
function Rock({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="4" cy="7" rx="15" ry="4" fill="#4a503c" opacity=".25" />
      <path d="M-15 5L-8-9L0-14L9-5L15 6L2 10Z" fill="#7e8066" />
      <path d="M-15 5L-8-9L0-14L-1 3Z" fill="#b5ad88" />
      <path d="M0-14L9-5L15 6L-1 3Z" fill="#92937a" />
      <path
        d="M-8-9L-3-6L0-14M-1 3L2 10"
        fill="none"
        stroke="#d0c5a0"
        strokeOpacity=".5"
        strokeWidth=".8"
      />
    </g>
  );
}
const LandTile = memo(function LandTile({
  t,
  prefix,
  season,
  neighbors,
}: {
  t: Tile;
  prefix: string;
  season: Season;
  neighbors: boolean[];
}) {
  const b = t.eco!.biome,
    x = t.x,
    y = t.y;
  const winter = season === 'winter',
    autumn = season === 'autumn';
  const seed = x * 9 + y * 13;
  const l = neighbors[3] ? -1 : 5,
    r = neighbors[1] ? 61 : 55,
    top = neighbors[0] ? -1 : 5,
    bottom = neighbors[2] ? 61 : 55;
  const lake = `M${l + 9} ${top}Q30 ${top + 2} ${r - 9} ${top}Q${r} ${top} ${r} ${top + 10}Q${r - 2} 30 ${r} ${bottom - 10}Q${r} ${bottom} ${r - 9} ${bottom}Q30 ${bottom - 2} ${l + 9} ${bottom}Q${l} ${bottom} ${l} ${bottom - 10}Q${l + 2} 30 ${l} ${top + 10}Q${l} ${top} ${l + 9} ${top}Z`;
  const clip = `${prefix}-lake-${x}-${y}`;
  return (
    <g transform={`translate(${x * TILE} ${y * TILE})`} pointerEvents="none">
      {b === 'water' ? (
        <>
          <rect x="-.5" y="-.5" width="61" height="61" fill={`url(#${prefix}-land)`} />
          <defs>
            <clipPath id={clip}>
              <path d={lake} />
            </clipPath>
          </defs>
          <path
            d={lake}
            fill={`url(#${prefix}-water)`}
            stroke={neighbors.some(Boolean) ? 'none' : '#b7b78d'}
            strokeWidth="3"
          />
          {!neighbors[0] && (
            <path
              d={`M${l + 8} ${top}Q30 ${top + 2} ${r - 8} ${top}`}
              fill="none"
              stroke="#c2bb91"
              strokeOpacity=".7"
              strokeWidth="2"
            />
          )}
          {!neighbors[2] && (
            <path
              d={`M${l + 8} ${bottom}Q30 ${bottom - 2} ${r - 8} ${bottom}`}
              fill="none"
              stroke="#56774e"
              strokeOpacity=".6"
              strokeWidth="2"
            />
          )}
          <g clipPath={`url(#${clip})`}>
            {Array.from({ length: 5 }, (_, i) => {
              const yy = 10 + i * 10,
                xx = noise(x, y, i) * 22;
              return (
                <path
                  key={i}
                  d={`M${xx} ${yy}q8 -3 17 0t17 0`}
                  stroke={i % 2 ? '#a4c4b1' : '#d0d5b1'}
                  opacity=".25"
                  strokeWidth="1"
                  fill="none"
                />
              );
            })}
          </g>
        </>
      ) : (
        <>
          <rect x="-.5" y="-.5" width="61" height="61" fill={`url(#${prefix}-land)`} />
          <path
            d={`M-2 ${12 + noise(x, y, 0) * 10}Q19 -9 53 2T64 45Q43 67 11 60T-2 25Z`}
            fill={
              b === 'forest'
                ? '#496545'
                : b === 'wetland'
                  ? '#839783'
                  : b === 'hill'
                    ? '#a49d75'
                    : b === 'floodplain'
                      ? '#b7ab73'
                      : '#a0a66e'
            }
            opacity={winter ? 0.22 : 0.36}
          />
          {Array.from({ length: 12 }, (_, i) => {
            const xx = 5 + noise(x, y, i) * 50,
              yy = 5 + noise(y, x, i + 3) * 50;
            return (
              <g key={i} opacity={b === 'forest' ? 0.3 : 0.5}>
                <path
                  d={`M${xx} ${yy}l-2 -3m2 3l2 -5m-2 5v-4`}
                  stroke={winter ? '#b6b7a0' : b === 'floodplain' ? '#bdaf77' : '#6d8554'}
                  strokeWidth=".8"
                  fill="none"
                />
                <circle cx={xx + 3} cy={yy + 2} r=".6" fill="#d6ce9a" />
              </g>
            );
          })}
          {b === 'forest' &&
            [
              [15, 25, 0.8],
              [39, 24, 0.95],
              [25, 48, 0.95],
              [49, 49, 0.68],
            ].map(([tx, ty, s], i) => (
              <Tree
                key={i}
                x={tx + noise(x, y, i) * 4}
                y={ty}
                s={s}
                autumn={autumn}
                winter={winter}
                variant={seed + i}
              />
            ))}
          {b === 'hill' && (
            <>
              <path
                d="M-5 46Q13 14 38 12T67 25M-8 55Q15 24 43 23T70 34"
                fill="none"
                stroke="#c4bc91"
                strokeWidth="1"
                opacity=".6"
              />
              <Rock x={23} y={31} s={1.2} />
              <Rock x={43} y={48} s={0.7} />
            </>
          )}
          {b === 'wetland' && (
            <>
              <path
                d="M2 32Q17 17 32 23T60 17L60 28Q40 38 21 31T2 42Z"
                fill="#6e9990"
                opacity=".65"
              />
              {[12, 30, 49].map((xx, i) => (
                <g key={xx} stroke="#61724b" strokeWidth="1" fill="none">
                  <path d={`M${xx} ${43 + i * 3}v-17m0 15q-6-4-7-11m7 8q4-8 7-9`} />
                  <path d={`M${xx} ${27 + i * 3}v-6`} stroke="#786247" strokeWidth="2.2" />
                </g>
              ))}
            </>
          )}
          {b === 'floodplain' && (
            <path
              d="M-4 42Q13 36 25 38T63 28M-2 47Q13 41 28 43T64 34"
              fill="none"
              stroke="#c1b481"
              strokeWidth="2"
              opacity=".65"
            />
          )}
          {b === 'meadow' && noise(x, y, 1) > 0.65 && (
            <Tree x={41} y={42} s={0.5} autumn={autumn} winter={winter} variant={seed} />
          )}
        </>
      )}
      {t.eco!.improvements.road > 0 && (
        <path
          d="M0 48Q28 30 60 36"
          stroke="#c4b58c"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      )}
      {!!t.eco!.fields.length && (
        <g transform="translate(7 32)">
          <path d="M0 0L36-5L42 14L4 19Z" fill="#786347" stroke="#c3ad70" strokeWidth="1.2" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${5 + i * 6} -1l4 16`}
              stroke={t.eco!.fields.some((f) => f.stage === 'ripe') ? '#d5bd73' : '#9ea367'}
              strokeWidth="2"
            />
          ))}
        </g>
      )}
      {!!t.eco!.structures.length && (
        <g transform="translate(26 32)">
          <ellipse cx="3" cy="16" rx="17" ry="5" fill="#293e2e" opacity=".35" />
          <path d="M-12 1L0-8L15 1V16L-12 12Z" fill="#c2ac7d" />
          <path d="M0-8L15 1V16L0 11Z" fill="#9b855f" />
          <path d="M-17 1L-1-14L20 1L4-4Z" fill="#685d43" />
          <path d="M-15-1L-1-13L15-1" stroke="#d1bd84" strokeWidth="1" fill="none" />
          <path d="M-7 12V4L-1 5V13" fill="#4e503b" />
        </g>
      )}
    </g>
  );
});
export default function EcoMap({
  world: w,
  region,
  selected,
  onSelect,
  layer = 'terrain',
}: {
  layer?: string;
  world: World;
  region: number;
  selected: [number, number];
  onSelect: (p: [number, number]) => void;
}) {
  const prefix = useId().replace(/:/g, ''),
    [grid, setGrid] = useState(false),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<[number, number] | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(
    null,
  );
  const svg = useRef<SVGSVGElement>(null);
  const size = w.config.size * TILE;
  const tiles = useMemo(() => w.tiles.filter((t) => t.eco!.region === region), [w.tiles, region]);
  const byPos = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  const people = w.agents.filter((a) => a.eco!.region === region);
  const label = hover
    ? `${NAMES[byPos.get(hover.join(','))!.eco!.biome]} · ${hover.join(', ')}`
    : '拖动浏览 · 点击地块查看';
  return (
    <div className="eco-map-shell">
      <div className="eco-map-caption">
        <span>
          REGION {String(region + 1).padStart(2, '0')} <b>{w.ecology!.regionNames[region]}</b>
        </span>
        <span className="eco-compass">↑ N</span>
      </div>
      <div className="eco-map" style={{ display: 'block' }}>
        <svg
          ref={svg}
          viewBox={`${pan.x} ${pan.y} ${size / zoom} ${size / zoom}`}
          role="group"
          aria-label="生态地形地图"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !svg.current) return;
            const dx = e.clientX - d.x,
              dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 5) {
              d.moved = true;
              svg.current.setPointerCapture(e.pointerId);
              const scale = size / zoom / svg.current.getBoundingClientRect().width;
              const margin = size * 0.15;
              setPan({
                x: Math.max(-margin, Math.min(size - size / zoom + margin, d.px - dx * scale)),
                y: Math.max(-margin, Math.min(size - size / zoom + margin, d.py - dy * scale)),
              });
            }
          }}
          onPointerUp={() => {
            setTimeout(() => {
              drag.current = null;
            }, 0);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <linearGradient id={`${prefix}-land`} x2=".8" y2="1">
              <stop stopColor={w.ecology!.climate.season === 'winter' ? '#b3b7a0' : '#919d70'} />
              <stop
                offset="1"
                stopColor={w.ecology!.climate.season === 'autumn' ? '#a59d6b' : '#879667'}
              />
            </linearGradient>
            <linearGradient id={`${prefix}-water`} x2=".3" y2="1">
              <stop stopColor="#638e8e" />
              <stop offset=".5" stopColor="#527f85" />
              <stop offset="1" stopColor="#436c76" />
            </linearGradient>
            <pattern id={`${prefix}-grain`} width="7" height="9" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="3" r=".6" fill="#263d2b" opacity=".08" />
              <circle cx="5" cy="7" r=".6" fill="#f2e1ab" opacity=".14" />
            </pattern>
            <filter id={`${prefix}-marker`} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".3" />
            </filter>
          </defs>
          <rect x="-200" y="-200" width={size + 400} height={size + 400} fill="#25392f" />
          {tiles.map((t) => (
            <LandTile
              key={`${t.x},${t.y}`}
              t={t}
              season={w.ecology!.climate.season}
              prefix={prefix}
              neighbors={[
                [0, -1],
                [1, 0],
                [0, 1],
                [-1, 0],
              ].map(([dx, dy]) => byPos.get(`${t.x + dx},${t.y + dy}`)?.eco!.biome === 'water')}
            />
          ))}
          <rect width={size} height={size} fill={`url(#${prefix}-grain)`} pointerEvents="none" />
          {grid && (
            <g stroke="#293d2e" strokeOpacity=".2" strokeWidth="1" pointerEvents="none">
              {Array.from({ length: w.config.size + 1 }, (_, i) => (
                <path key={i} d={`M${i * TILE} 0V${size}M0 ${i * TILE}H${size}`} />
              ))}
            </g>
          )}
          {tiles.map((t) => {
            const alive = people.filter((a) => !a.death && a.x === t.x && a.y === t.y),
              dead =
                people.some((a) => a.death && a.x === t.x && a.y === t.y) ||
                (w.ecology!.relicCorpses ?? []).some(
                  (a) => a.region === region && a.x === t.x && a.y === t.y,
                );
            return (
              <g
                key={`hit-${t.x},${t.y}`}
                role="button"
                tabIndex={0}
                aria-label={`${NAMES[t.eco!.biome]} ${t.x},${t.y}${alive.length ? ` · ${alive.length} 人` : ''}`}
                className="eco-map-tile"
                onPointerEnter={() => setHover([t.x, t.y])}
                onPointerLeave={() => setHover(null)}
                onClick={() => {
                  if (!drag.current?.moved) onSelect([t.x, t.y]);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect([t.x, t.y]);
                  }
                }}
              >
                <title>
                  {NAMES[t.eco!.biome]} ({t.x}, {t.y})
                  {alive.map((a) => ` · ${a.name} #${a.id}`).join('')}
                </title>
                <rect
                  x={t.x * TILE}
                  y={t.y * TILE}
                  width={TILE}
                  height={TILE}
                  fill="transparent"
                  className="eco-map-hit"
                />
                {alive.length > 0 && (
                  <g
                    transform={`translate(${t.x * TILE + 30} ${t.y * TILE + 29})`}
                    filter={`url(#${prefix}-marker)`}
                    pointerEvents="none"
                  >
                    <path
                      d="M-10 0a10 10 0 1 1 20 0q0 9-10 17Q-10 9-10 0Z"
                      fill={alive.some((a) => a.role === 'prophet') ? '#e3c77f' : '#efe6c8'}
                      stroke="#526042"
                      strokeWidth="1.4"
                    />
                    <circle cy="-2" r="3" fill="#596348" />
                    <path d="M-5 7q0-7 5-7t5 7" fill="#596348" />
                    {alive.length > 1 && (
                      <>
                        <circle
                          cx="12"
                          cy="-9"
                          r="7"
                          fill="#324f40"
                          stroke="#e4d6ae"
                          strokeWidth="1"
                        />
                        <text x="12" y="-6" fontSize="9" fill="#fff1cc" textAnchor="middle">
                          {alive.length}
                        </text>
                      </>
                    )}
                  </g>
                )}
                {dead && !alive.length && (
                  <g
                    transform={`translate(${t.x * TILE + 30} ${t.y * TILE + 32})`}
                    pointerEvents="none"
                  >
                    <path
                      d="M-6-6L6 6M6-6L-6 6"
                      stroke="#d7c9a5"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <circle r="10" fill="none" stroke="#5c6150" strokeWidth="1" />
                  </g>
                )}
              </g>
            );
          })}
          <g pointerEvents="none" aria-label="城墙与铭文">
            {tiles.map((t) => {
              const wall = t
                .eco!.structures.filter(
                  (s) =>
                    BUILDINGS[s.kind]?.wall &&
                    s.progress >= BUILDINGS[s.kind].minutes &&
                    s.condition > 0,
                )
                .sort((a, b) => BUILDINGS[b.kind].wall!.tier - BUILDINGS[a.kind].wall!.tier)[0];
              const written = t.eco!.ground.some((b) => b.inscription);
              return (
                <g key={`fort-${t.x}-${t.y}`} transform={`translate(${t.x * TILE} ${t.y * TILE})`}>
                  {wall && (
                    <>
                      <rect
                        x="5"
                        y="5"
                        width="50"
                        height="50"
                        rx="3"
                        fill="none"
                        stroke={
                          ['', '#98754a', '#ac956c', '#c7c4ad', '#ddd5c4'][
                            BUILDINGS[wall.kind].wall!.tier
                          ]
                        }
                        strokeWidth={2 + BUILDINGS[wall.kind].wall!.tier}
                      />
                      <text x="9" y="17" fontSize="10" fill="#fff5d6">
                        墙{BUILDINGS[wall.kind].wall!.tier}
                      </text>
                    </>
                  )}
                  {written && (
                    <>
                      <rect
                        x="5"
                        y="39"
                        width="14"
                        height="17"
                        rx="2"
                        fill="#d6c5a1"
                        stroke="#5a4e3b"
                      />
                      <path d="M8 44H16M8 48H16M8 52H14" stroke="#5a4e3b" />
                    </>
                  )}
                </g>
              );
            })}
          </g>
          <g pointerEvents="none" aria-label="聚居地范围">
            {settlements(w)
              .filter((s) => s.region === region)
              .map((s) => (
                <rect
                  key={`${s.x},${s.y}`}
                  x={(s.x - 1) * TILE + 3}
                  y={(s.y - 1) * TILE + 3}
                  width={TILE * 3 - 6}
                  height={TILE * 3 - 6}
                  rx="16"
                  fill="none"
                  stroke="#eed7a2"
                  strokeWidth="2"
                  strokeDasharray="7 5"
                />
              ))}
          </g>
          <g aria-label="野兽位置" pointerEvents="none">
            {(w.ecology?.beasts ?? [])
              .filter((b) => b.region === region && b.hp > 0)
              .map((b) => (
                <g key={b.id} transform={`translate(${b.x * TILE + 46} ${b.y * TILE + 14})`}>
                  <title>
                    {BEAST_NAMES[b.species]} {b.id} · 生命 {b.hp}/{b.maxHp} · 攻击 {b.attack}
                  </title>
                  <circle r="13" fill="#6f362c" stroke="#f3c6a0" strokeWidth="1.5" />
                  <path d="M-8-3L-9-10L-3-6L3-6L9-10L8-3L6 6L0 10L-6 6Z" fill="#cfa578" />
                  <path d="M-5-1L-2 1M5-1L2 1" stroke="#38251c" strokeWidth="2" />
                  <path d="M-3 5L0 7L3 5" stroke="#38251c" fill="none" strokeWidth="2" />
                </g>
              ))}
          </g>
          {layer === 'food' && (
            <g pointerEvents="none" aria-label="野生食物热量分布">
              {tiles.map((t) => {
                const fd = Object.entries(t.eco!.biomass).reduce(
                  (n, [id, kg]) => n + (kg * (ITEMS[id]?.kcal ?? 0)) / 2500,
                  0,
                );
                return fd > 0.05 ? (
                  <g
                    key={`food-${t.x}-${t.y}`}
                    transform={`translate(${t.x * TILE + 30} ${t.y * TILE + 30})`}
                  >
                    <circle
                      r={Math.min(24, 10 + Math.log1p(fd) * 2)}
                      fill="#2e4939"
                      fillOpacity=".88"
                      stroke="#e1c781"
                      strokeWidth="1"
                    />
                    <text y="4" fontSize="12" textAnchor="middle" fill="#f0dfaa">
                      {fd < 10 ? fd.toFixed(1) : Math.round(fd)}
                    </text>
                  </g>
                ) : null;
              })}
            </g>
          )}
          <g
            transform={`translate(${selected[0] * TILE} ${selected[1] * TILE})`}
            pointerEvents="none"
          >
            <rect
              x="1"
              y="1"
              width="58"
              height="58"
              fill="#fae6a2"
              fillOpacity=".1"
              stroke="#f5dfa0"
              strokeWidth="2"
            />
            <path
              d="M1 11V1H11M49 1H59V11M59 49V59H49M11 59H1V49"
              fill="none"
              stroke="#fff0c2"
              strokeWidth="4"
            />
          </g>
        </svg>
      </div>
      <div className="eco-map-tools">
        <span>{label}</span>
        <div>
          <button aria-label="缩小地图" onClick={() => setZoom((v) => Math.max(1, v / 1.4))}>
            −
          </button>
          <button aria-label="放大地图" onClick={() => setZoom((v) => Math.min(4, v * 1.4))}>
            +
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            复位
          </button>
          <button aria-pressed={grid} onClick={() => setGrid((v) => !v)}>
            网格
          </button>
        </div>
      </div>
      <div className="eco-map-scale">
        <span>0 ├─────┤ 500 m</span>
        <span>{layer === 'food' ? '现存野食 / FD（非每日产量）' : '250 m / 地块'}</span>
      </div>
    </div>
  );
}
