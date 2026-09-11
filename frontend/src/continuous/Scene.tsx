import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { position, TILE, type World, type Site } from './types';
import { architecture, treeArt, wallArt, characterArt } from './art';

const U = 42,
  V = 21;
const project = (x: number, y: number) => ({ x: ((x - y) / TILE) * U, y: ((x + y) / TILE) * V });
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 91.3 + y * 273.1) * 47453.13;
  return v - Math.floor(v);
};
type Frame = { world: World; at: number };
export default function Scene({
  active = true,
  frames,
  selected,
  onSelect,
  onSite,
  paths,
  replay,
}: {
  active?: boolean;
  frames: React.RefObject<Frame[]>;
  selected: number;
  onSelect: (id: number) => void;
  onSite: (id: string) => void;
  paths: boolean;
  replay?: World;
}) {
  const host = useRef<HTMLDivElement>(null),
    application = useRef<Application | undefined>(undefined),
    current = useRef({ active, selected, onSelect, onSite, paths, replay });
  current.current = { active, selected, onSelect, onSite, paths, replay };
  useEffect(() => {
    if (active) application.current?.start();
    else application.current?.stop();
  }, [active]);
  useEffect(() => {
    let cancelled = false,
      app: Application | undefined,
      resize: ResizeObserver | undefined;
    const mount = host.current!;
    void (async () => {
      const pixi = new Application();
      app = pixi;
      await pixi.init({
        resizeTo: mount,
        background: '#243b32',
        antialias: true,
        resolution: Math.min(2, devicePixelRatio),
        autoDensity: true,
      });
      if (cancelled) {
        pixi.destroy(true, { children: true });
        return;
      }
      application.current = pixi;
      if (!current.current.active) pixi.stop();
      mount.appendChild(pixi.canvas);
      pixi.canvas.setAttribute('aria-label', '连续村庄地图，拖动平移，滚轮缩放，点击居民查看行动');
      const root = new Container(),
        ground = new Container(),
        objects = new Container(),
        routes = new Graphics(),
        overlay = new Container();
      pixi.stage.addChild(root);
      root.addChild(ground, routes, objects, overlay);
      objects.sortableChildren = true;
      let cropStamp = -1,
        worldId = '',
        fit = 1,
        zoom = 1,
        pan = { x: 0, y: 0 },
        drag: PointLike | undefined;
      const actors = new Map<
        number,
        {
          node: Container;
          body: Container;
          limbs: Graphics;
          ring: Graphics;
          name: Text;
          bubble: Text;
          status: Text;
          shadow: Graphics;
        }
      >();
      const doors = new Map<string, { node: Container; bar: Graphics }>();
      const crops = new Map<string, Graphics>();
      const roofs = new Map<string, Container>();
      type PointLike = { x: number; y: number; px: number; py: number };
      const transform = () => {
        fit = Math.min(mount.clientWidth / 1530, mount.clientHeight / 825);
        root.scale.set(fit * zoom);
        root.position.set(mount.clientWidth / 2 + pan.x, mount.clientHeight * 0.075 + pan.y);
      };
      resize = new ResizeObserver(transform);
      resize.observe(mount);
      transform();
      pixi.stage.eventMode = 'static';
      pixi.stage.hitArea = pixi.screen;
      pixi.stage.on('pointerdown', (e: FederatedPointerEvent) => {
        drag = { x: e.global.x, y: e.global.y, px: pan.x, py: pan.y };
      });
      pixi.stage.on('pointermove', (e: FederatedPointerEvent) => {
        if (drag) {
          pan = { x: drag.px + e.global.x - drag.x, y: drag.py + e.global.y - drag.y };
          transform();
        }
      });
      pixi.stage.on('pointerup', () => {
        drag = undefined;
      });
      pixi.stage.on('pointerupoutside', () => {
        drag = undefined;
      });
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        const bounds = pixi.canvas.getBoundingClientRect();
        const point = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
        const local = {
          x: (point.x - root.position.x) / root.scale.x,
          y: (point.y - root.position.y) / root.scale.y,
        };
        zoom = Math.max(0.65, Math.min(3.8, zoom * Math.exp(-e.deltaY * 0.001)));
        transform();
        pan.x += point.x - (root.position.x + local.x * root.scale.x);
        pan.y += point.y - (root.position.y + local.y * root.scale.y);
        transform();
      };
      pixi.canvas.addEventListener('wheel', wheel, { passive: false });
      const reset = () => {
        zoom = 1;
        pan = { x: 0, y: 0 };
        transform();
      };
      pixi.canvas.addEventListener('dblclick', reset);
      const poly = (g: Graphics, pts: number[], color: number, alpha = 1) =>
        g.poly(pts).fill({ color, alpha });
      const tile = (g: Graphics, x: number, y: number, c: number) =>
        poly(g, [x, y - V, x + U, y, x, y + V, x - U, y], c);
      const label = (text: string, size = 12, color = 0xdedcc0) =>
        new Text({
          text,
          style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fill: color },
        });
      const tree = (x: number, y: number, n: number) => {
        const obj = treeArt(Math.floor(n * 1000)),
          p = project(x, y);
        obj.position.set(p.x, p.y);
        obj.zIndex = p.y;
        objects.addChild(obj);
      };
      const build = (site: Site) => {
        const art = architecture(site.kind, Math.floor(site.x + site.y)),
          node = art.node;
        const p = project(site.x, site.y);
        node.position.set(p.x, p.y);
        node.zIndex = p.y;
        objects.addChild(node);
        node.eventMode = 'static';
        node.cursor = 'pointer';
        node.on('pointertap', () => current.current.onSite(site.id));
        if (art.roof) roofs.set(site.id, art.roof);
        if (site.kind === 'gate') {
          const bar = new Graphics();
          node.addChild(bar);
          doors.set(site.id, { node, bar });
        }
        const t = label(site.kind === 'hall' ? '橡木大厅' : site.label, 12);
        t.anchor.set(0.5, 0);
        t.position.set(0, site.kind === 'hall' ? 52 : 47);
        node.addChild(t);
      };
      const init = (w: World) => {
        ground.removeChildren().forEach((v) => v.destroy({ children: true }));
        objects.removeChildren().forEach((v) => v.destroy({ children: true }));
        overlay.removeChildren().forEach((v) => v.destroy({ children: true }));
        actors.clear();
        doors.clear();
        crops.clear();
        roofs.clear();
        worldId = w.id;
        cropStamp = -1;
        const g = new Graphics();
        ground.addChild(g);
        const roads = new Set(
          w.roads.map((p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`),
        );
        const fieldIds = new Set(
          w.fields.map((p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`),
        );
        for (let y = 0; y < w.size.h; y++)
          for (let x = 0; x < w.size.w; x++) {
            const p = project((x + 0.5) * TILE, (y + 0.5) * TILE),
              n = noise(x, y),
              road = roads.has(`${x},${y}`),
              field = fieldIds.has(`${x},${y}`);
            const plaza = x >= 7 && x <= 9 && y >= 7 && y <= 9;
            tile(g, p.x, p.y, field ? 0x67513c : plaza ? 0x8b9277 : road ? 0xa39775 : 0x687b4b);
            if (road || plaza) {
              const count = plaza ? 5 : 4;
              for (let i = 0; i < count; i++)
                for (let j = 0; j < count; j++) {
                  const pp = project(
                    (x + (i + 0.5) / count) * TILE,
                    (y + (j + 0.5) / count) * TILE,
                  );
                  const ww = (U / count) * 0.87,
                    hh = (V / count) * 0.83;
                  poly(
                    g,
                    [pp.x, pp.y - hh, pp.x + ww, pp.y, pp.x, pp.y + hh, pp.x - ww, pp.y],
                    (plaza
                      ? [0xa6a78b, 0x989d80, 0xb0ad8e, 0x929980]
                      : [0xaeaa86, 0xa19d7a, 0xb8b18d, 0x9a9b75])[
                      Math.floor(noise(i + x * 3, j + y * 4) * 4)
                    ],
                    0.75,
                  );
                  g.moveTo(pp.x - ww, pp.y)
                    .lineTo(pp.x, pp.y - hh)
                    .lineTo(pp.x + ww, pp.y)
                    .stroke({ color: 0xddd0a7, width: 0.65, alpha: 0.25 });
                }
            } else if (!field) {
              for (let i = 0; i < 13; i++) {
                const u = noise(x * 13 + i, y),
                  v = noise(y * 11 + i, x),
                  pp = project((x + u) * TILE, (y + v) * TILE);
                g.ellipse(pp.x, pp.y, 4 + noise(i, y) * 8, 1.4 + noise(i, x) * 3).fill({
                  color: i % 3 ? 0x879657 : 0x425c3c,
                  alpha: 0.13,
                });
                if (i % 2 === 0) {
                  g.moveTo(pp.x - 2, pp.y)
                    .lineTo(pp.x - 3, pp.y - 3)
                    .moveTo(pp.x, pp.y)
                    .lineTo(pp.x + 1, pp.y - 4)
                    .stroke({ color: 0xb4b777, alpha: 0.4, width: 0.8 });
                }
                if (i === 4 && noise(x, y) > 0.73) g.circle(pp.x, pp.y - 2, 1).fill(0xe1c97c);
              }
            }
            if (field) {
              for (let i = -3; i <= 3; i++)
                g.moveTo(p.x - 26 + i * 4, p.y - 10 + i * 3)
                  .lineTo(p.x + 18 + i * 4, p.y + 12 + i * 3)
                  .stroke({ color: 0x382f23, alpha: 0.35, width: 2 });
            }
          }
        const wallCells = new Set(
          w.walls.map((p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`),
        );
        const gateCells = new Set(
          w.gates.map((p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`),
        );
        for (const wall of w.walls) {
          const p = project(wall.x, wall.y),
            node = new Container();
          const x = Math.floor(wall.x / TILE),
            y = Math.floor(wall.y / TILE);
          node.position.set(p.x, p.y);
          node.zIndex = p.y + 16;
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ]) {
            const k = `${x + dx},${y + dy}`;
            if ((dx > 0 || dy > 0) && wallCells.has(k)) node.addChild(wallArt(dx, dy));
            if (gateCells.has(k)) node.addChild(wallArt(dx * 0.46, dy * 0.46));
          }
          objects.addChild(node);
        }
        for (const site of w.sites) if (site.kind !== 'field') build(site);
        for (const f of w.fields) {
          const p = project(f.x, f.y),
            g = new Graphics();
          g.position.set(p.x, p.y);
          g.zIndex = p.y;
          objects.addChild(g);
          crops.set(f.id, g);
        }
        for (const [x, y] of [
          [1, 2],
          [2, 3],
          [2, 12],
          [3, 13],
          [14, 9],
          [15, 10],
          [16, 13],
          [8, 2],
          [9, 3],
          [2, 6],
          [14, 14],
          [7, 14],
          [1, 10],
        ])
          tree((x + 0.5) * TILE, (y + 0.5) * TILE, noise(x, y));
        for (const a of w.agents) {
          const node = new Container(),
            shadow = new Graphics(),
            bodyNode = new Container(),
            limbs = new Graphics(),
            ring = new Graphics();
          const torso = characterArt(a);
          shadow.ellipse(0, 2, 9, 3.3).fill({ color: 0x172b21, alpha: 0.4 });
          bodyNode.scale.set(1.13);
          bodyNode.addChild(limbs, torso);
          node.addChild(shadow, ring, bodyNode);
          const name = label(a.name, 12);
          name.anchor.set(0.5, 0);
          name.y = 9;
          node.addChild(name);
          const status = label('', 13, 0xffda83);
          status.anchor.set(0.5, 1);
          status.y = -46;
          node.addChild(status);
          const bubble = new Text({
            text: '',
            style: {
              fontFamily: 'system-ui',
              fontSize: 13,
              fill: 0x22372e,
              wordWrap: true,
              wordWrapWidth: 160,
              dropShadow: { color: 0xeae3c5, blur: 7, distance: 0, alpha: 1 },
            },
          });
          bubble.anchor.set(0.5, 1);
          bubble.y = -61;
          node.addChild(bubble);
          node.eventMode = 'static';
          node.cursor = 'pointer';
          node.on('pointertap', () => current.current.onSelect(a.id));
          objects.addChild(node);
          actors.set(a.id, { node, body: bodyNode, limbs, ring, name, bubble, status, shadow });
        }
      };
      pixi.ticker.add(() => {
        const feed = frames.current,
          last = feed.at(-1);
        if (!last && !current.current.replay) return;
        let w = current.current.replay ?? last!.world,
          time = w.time;
        if (!current.current.replay && w.status === 'running') {
          // Play committed history with a short buffer. Never predict uncommitted outcomes.
          const wanted = Math.max(
            0,
            Math.min(w.time, w.time + (performance.now() - last!.at - 350) * 720),
          );
          w = [...feed].reverse().find((f) => f.world.time <= wanted)?.world ?? feed[0].world;
          time = Math.max(w.time, wanted);
        }
        if (worldId !== w.id) init(w);
        routes.clear();
        for (const gate of w.gates) {
          const v = doors.get(gate.id)!;
          v.bar.clear();
          if (!gate.open) {
            v.bar.poly([-20, -5, 20, -5, 20, -33, -20, -33]).fill(0x71583c);
            for (let x = -17; x < 20; x += 7)
              v.bar.moveTo(x, -5).lineTo(x, -33).stroke({ color: 0xb39c66, width: 2 });
          } else {
            v.bar.rect(-24, -28, 5, 25).fill(0x8f7350);
          }
        }
        const stamp = Math.floor(time / 8640000);
        if (stamp !== cropStamp) {
          cropStamp = stamp;
          for (const f of w.fields) {
            const g = crops.get(f.id)!;
            g.clear();
            const growth = Math.min(1, (time % (30 * 86400000)) / (30 * 86400000));
            for (let i = 0; i < 6; i++)
              for (let j = 0; j < 6; j++) {
                const pt = project((i / 6 - 0.42) * TILE, (j / 6 - 0.42) * TILE),
                  h = 4 + growth * 11 + noise(i, j) * 3;
                const color = f.harvest > 0 ? 0xd3b366 : 0x92a461;
                g.moveTo(pt.x, pt.y)
                  .quadraticCurveTo(pt.x + 1, pt.y - h * 0.6, pt.x + 2, pt.y - h)
                  .stroke({ color, width: 0.9 });
                g.moveTo(pt.x, pt.y - h * 0.3)
                  .quadraticCurveTo(pt.x - 4, pt.y - h * 0.65, pt.x - 3, pt.y - h * 0.8)
                  .stroke({ color: 0x718a4a, width: 1 });
                g.moveTo(pt.x + 1, pt.y - h * 0.5)
                  .quadraticCurveTo(pt.x + 5, pt.y - h * 0.65, pt.x + 5, pt.y - h * 0.9)
                  .stroke({ color: 0xa5b271, width: 0.8 });
                if (growth > 0.35 || f.harvest > 0) {
                  g.ellipse(pt.x + 2, pt.y - h, 1.5, 3.2).fill(color);
                  g.moveTo(pt.x + 2, pt.y - h - 3)
                    .lineTo(pt.x + 3, pt.y - h - 5)
                    .stroke({ color: 0xe0c783, width: 0.5 });
                }
              }
          }
        }
        for (const a of w.agents) {
          const v = actors.get(a.id)!;
          const p = position(a, time),
            screen = project(p.x, p.y),
            moving = !!a.motion,
            selected = current.current.selected === a.id;
          v.node.position.set(screen.x, screen.y);
          v.node.zIndex = screen.y;
          const indoors = w.sites.some(
            (s) =>
              ['home', 'hall', 'workshop'].includes(s.kind) &&
              Math.hypot(p.x - s.x, p.y - s.y) < TILE * 0.32,
          );
          // Unselected occupants are occluded by the building; selecting one
          // opens the roof below instead of drawing a person on its facade.
          v.node.visible = !indoors || selected;
          v.ring.clear();
          if (selected) v.ring.ellipse(0, 1, 13, 6).stroke({ color: 0xffd792, width: 2 });
          const phase = performance.now() / 100,
            walk = moving ? Math.sin(phase) * 4 : 0;
          v.limbs
            .clear()
            .moveTo(-3, -10)
            .lineTo(-3 - walk, 0)
            .moveTo(3, -10)
            .lineTo(3 + walk, 0)
            .stroke({ color: 0x433d30, width: 3 });
          const work = a.action?.kind === 'work';
          v.limbs
            .moveTo(-5, -20)
            .lineTo(-8 + (work ? Math.sin(phase) * 4 : 0), -12)
            .moveTo(5, -20)
            .lineTo(8 - (work ? Math.sin(phase) * 4 : 0), -12)
            .stroke({ color: 0xddbc8c, width: 2 });
          if (work) v.limbs.moveTo(7, -15).lineTo(15, -3).stroke({ color: 0xa08958, width: 2 });
          v.body.y = moving ? Math.abs(Math.sin(phase)) : -0;
          v.body.rotation = a.dead ? -Math.PI / 2 : 0;
          v.node.alpha = a.dead ? 0.55 : 1;
          v.status.text = a.thinking
            ? '◌ 思考'
            : a.blocked
              ? '! 受阻'
              : a.action?.kind === 'eat'
                ? '● 进食'
                : work
                  ? '♧ 劳动'
                  : '';
          v.bubble.text = a.voice && a.voice.end >= time ? a.voice.text.slice(0, 32) : '';
          v.name.style.fill = selected ? 0xffe0a0 : 0xe9e3c9;
          if (current.current.paths && selected && a.motion) {
            const pts = a.motion.points.map((p) => project(p.x, p.y));
            routes.moveTo(pts[0].x, pts[0].y);
            for (const p of pts.slice(1)) routes.lineTo(p.x, p.y);
            routes.stroke({ color: 0xf1c571, width: 2, alpha: 0.9 });
          }
        }
        for (const [id, roof] of roofs) {
          const site = w.sites.find((s) => s.id === id)!,
            a = w.agents.find((a) => a.id === current.current.selected);
          roof.alpha =
            a && Math.hypot(position(a, time).x - site.x, position(a, time).y - site.y) < TILE
              ? 0.3
              : 1;
        }
      });
    })().catch((e) => {
      if (!cancelled) {
        mount.dataset.error = String(e);
        mount.textContent = `地图渲染初始化失败：${String(e)}`;
      }
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
      application.current = undefined;
      if (app?.renderer) app.destroy(true, { children: true });
    };
  }, [frames]);
  return <div className="cv-canvas" ref={host} />;
}
