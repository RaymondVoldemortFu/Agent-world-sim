import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { position, body, DAY, SPEED, TILE, type World } from './types';
import { buildings } from './game/space';
import { buildingArt, box, bake, mat, mesh, beam } from './game/models';
import { landscape, fieldArt } from './game/landscape';
import { character } from './game/characters';
import { present, type Frame } from './game/presentation';
import './game/game.css';

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
    labels = useRef<HTMLDivElement>(null),
    mini = useRef<HTMLCanvasElement>(null);
  const [cameraMode, setCameraMode] = useState<'village' | 'follow'>('village'),
    [daylight, setDaylight] = useState(true),
    [roofMode, setRoofMode] = useState(false),
    [quality, setQuality] = useState<'high' | 'low'>('high'),
    [error, setError] = useState('');
  const commands = useRef({ reset: () => {}, focus: () => {} }),
    current = useRef({
      active,
      selected,
      onSelect,
      onSite,
      paths,
      replay,
      cameraMode,
      daylight,
      roofMode,
      quality,
    });
  current.current = {
    active,
    selected,
    onSelect,
    onSite,
    paths,
    replay,
    cameraMode,
    daylight,
    roofMode,
    quality,
  };
  useEffect(() => {
    const mount = host.current!,
      layer = labels.current!,
      minimap = mini.current!;
    let needsRender = true;
    let disposed = false,
      raf = 0;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'default',
      });
    } catch (e) {
      setError(`三维渲染无法启动：${String(e)}`);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.domElement.setAttribute(
      'aria-label',
      '三维村庄地图，拖动旋转，右键平移，滚轮缩放，点击居民查看行动',
    );
    mount.prepend(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color(0xb8c9c3);
    scene.fog = new T.FogExp2(0xb8c9c3, 0.0018);
    const camera = new T.PerspectiveCamera(40, 1, 0.5, 1400);
    camera.position.set(210, 96, 245);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(134, 0, 119);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 15;
    controls.maxDistance = 480;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minPolarAngle = 0.18;
    controls.screenSpacePanning = false;
    const hemi = new T.HemisphereLight(0xd4e4eb, 0x776d42, 2.5);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffe1ac, 3.2);
    sun.position.set(130, 200, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    Object.assign(sun.shadow.camera, {
      left: -190,
      right: 190,
      top: 190,
      bottom: -190,
      near: 1,
      far: 650,
    });
    sun.shadow.normalBias = 0.18;
    sun.shadow.bias = -0.00015;
    sun.target.position.set(130, 0, 120);
    scene.add(sun, sun.target);
    const worldRoot = new T.Group();
    scene.add(worldRoot);
    const actors = new Map<number, ReturnType<typeof character>>(),
      roofs = new Map<string, T.Group>(),
      crops = new Map<string, T.Group>(),
      gates = new Map<string, T.Group>(),
      dom = new Map<number, HTMLDivElement>();
    const interact: T.Object3D[] = [],
      smokes: { sprite: T.Sprite; origin: T.Vector3; offset: number }[] = [];
    let worldId = '',
      pathMotion = '',
      pathAgent = -1,
      lastStats = 0,
      lastMini = 0,
      lastShadow = 0,
      frameCount = 0,
      qualityValue = 'high',
      lastFollow: number | undefined;
    const lineMat = new T.LineDashedMaterial({
      color: 0xf3db98,
      dashSize: 1.5,
      gapSize: 1,
      depthTest: false,
    });
    const path = new T.Line(new T.BufferGeometry(), lineMat);
    path.renderOrder = 4;
    scene.add(path);
    const targetRing = mesh(
      new T.RingGeometry(1.4, 1.65, 40),
      new T.MeshBasicMaterial({
        color: 0xf4d596,
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.castShadow = false;
    scene.add(targetRing);
    const smokeCanvas = document.createElement('canvas');
    smokeCanvas.width = smokeCanvas.height = 64;
    const sc = smokeCanvas.getContext('2d')!,
      gradient = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(242,235,215,0.6)');
    gradient.addColorStop(1, 'rgba(242,235,215,0)');
    sc.fillStyle = gradient;
    sc.fillRect(0, 0, 64, 64);
    const smokeTexture = new T.CanvasTexture(smokeCanvas);
    let viewportWidth = 1,
      viewportHeight = 1;
    const labelText = new Map<number, string>();
    const resize = () => {
      const w = mount.clientWidth,
        h = mount.clientHeight;
      if (!w || !h) return;
      needsRender = true;
      viewportWidth = w;
      viewportHeight = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    const center = () => {
      const manor = frames.current.at(-1)?.world.manor;
      camera.position.set(
        ...((manor ? [345, 245, 470] : [255, 174, 303]) as [number, number, number]),
      );
      controls.target.set(...((manor ? [180, 0, 180] : [134, 0, 119]) as [number, number, number]));
      controls.update();
      lastFollow = undefined;
    };
    commands.current = {
      reset: center,
      focus: () => {
        const a = actors.get(current.current.selected);
        if (a) {
          controls.target.copy(a.root.position);
          camera.position.copy(a.root.position).add(new T.Vector3(20, 19, 28));
          controls.update();
        }
      },
    };
    function addActor(a: World['agents'][number]) {
      const model = character(a);
      worldRoot.add(model.root);
      actors.set(a.id, model);
      interact.push(model.root);
      const el = document.createElement('div');
      el.className = 'game-person-label';
      el.innerHTML = '<button type="button"></button><span></span>';
      const button = el.querySelector('button')!;
      button.textContent = a.name;
      button.setAttribute('aria-label', `选择居民 ${a.name}`);
      button.onclick = () => current.current.onSelect(a.id);
      layer.appendChild(el);
      dom.set(a.id, el);
    }
    function build(w: World) {
      worldId = w.id;
      if (w.manor) {
        camera.position.set(345, 245, 470);
        controls.target.set(180, 0, 180);
        sun.target.position.set(180, 0, 180);
      }
      const env = landscape(w);
      worldRoot.add(env.group);
      for (const b of buildings(w)) {
        const art = buildingArt(b, b.id.length);
        const g = new T.Group();
        g.position.set(b.x, 0, b.y);
        g.add(art.body, art.roof);
        g.userData.site = b.id;
        worldRoot.add(g);
        interact.push(g);
        roofs.set(b.id, art.roof);
        for (let i = 0; i < 7; i++) {
          const sprite = new T.Sprite(
            new T.SpriteMaterial({
              map: smokeTexture,
              transparent: true,
              depthWrite: false,
              opacity: 0.4,
            }),
          );
          const origin = new T.Vector3(
            b.x + art.chimney.x,
            art.chimney.y + 1.5,
            b.y + art.chimney.z,
          );
          sprite.position.copy(origin);
          worldRoot.add(sprite);
          smokes.push({ sprite, origin, offset: i / 7 });
        }
      }
      for (const f of w.fields) {
        const art = fieldArt(f.x, f.y, f.id.length);
        art.root.userData.site = f.id;
        worldRoot.add(art.root);
        interact.push(art.root);
        crops.set(f.id, art.crop);
      }
      for (const g of w.gates) {
        const door = new T.Group(),
          planks = new T.Group();
        for (let z = 0; z < 6.8; z += 0.6) box(planks, 0.22, 4.3, 0.55, 0, 2.15, z, 0x775333);
        for (const y of [0.6, 3.4]) box(planks, 0.28, 0.15, 6.8, 0, y, 3.4, 0x404840);
        beam(planks, new T.Vector3(0, 0.3, 0.3), new T.Vector3(0, 4.1, 6.5), 0.19, 0x494537);
        door.add(bake(planks));
        door.position.set(g.x, 0, g.y - 3.4);
        door.userData.site = g.id;
        worldRoot.add(door);
        gates.set(g.id, door);
        interact.push(door);
      }
      for (const s of w.sites.filter((s) => ['plaza', 'well'].includes(s.kind))) {
        const hit = mesh(
          new T.CylinderGeometry(3, 3, 3, 8),
          new T.MeshBasicMaterial({ visible: false }),
          s.x,
          1.5,
          s.y,
        );
        hit.userData.site = s.id;
        worldRoot.add(hit);
        interact.push(hit);
      }
      for (const a of w.agents) addActor(a);
      mount.dataset.engine = 'three';
      mount.dataset.worldVersion = w.version;
    }
    const pointer = new T.Vector2(),
      ray = new T.Raycaster();
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const hits = ray.intersectObjects(interact, true);
      if (hits.length) {
        let node: T.Object3D | null = hits[0].object;
        while (node) {
          if (node.userData.agent) {
            current.current.onSelect(node.userData.agent);
            return;
          }
          if (node.userData.site) {
            current.current.onSite(node.userData.site);
            return;
          }
          node = node.parent;
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('dblclick', center);
    const onMini = (e: MouseEvent) => {
      const r = minimap.getBoundingClientRect(),
        w = frames.current.at(-1)?.world;
      if (!w) return;
      const to = new T.Vector3(
        ((e.clientX - r.left) / r.width) * w.size.w * TILE,
        0,
        ((e.clientY - r.top) / r.height) * w.size.h * TILE,
      );
      camera.position.add(to.clone().sub(controls.target));
      controls.target.copy(to);
      controls.update();
    };
    minimap.addEventListener('click', onMini);
    const keys = new Set<string>();
    const keydown = (e: KeyboardEvent) => {
      if (
        current.current.active &&
        ['w', 'a', 's', 'd'].includes(e.key.toLowerCase()) &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement) &&
        !(e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        keys.add(e.key.toLowerCase());
        needsRender = true;
      }
    };
    const keyup = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const clearKeys = () => keys.clear();
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clearKeys);
    let previous = performance.now(),
      nextFrame = 0,
      totalFrames = 0,
      renderedKey = '';
    controls.addEventListener('change', () => {
      needsRender = true;
    });
    const render = (now: number) => {
      if (disposed) return;
      if (document.hidden) return;
      raf = requestAnimationFrame(render);
      const c = current.current;
      if (!c.active) {
        keys.clear();
        needsRender = true;
        return;
      }
      // Simulation runs on the server; rendering has its own power budget.
      if (now < nextFrame) return;
      const interval = 1000 / (keys.size || needsRender ? 60 : 30);
      nextFrame = now + interval - ((now - nextFrame) % interval);
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      const view = present(frames.current, now, c.replay);
      if (!view) {
        if (needsRender) renderer.render(scene, camera);
        needsRender = false;
        return;
      }
      const w = view.world,
        time = view.time;
      const layout = buildings(w);
      if (!worldId) build(w);
      controls.update();
      camera.updateMatrixWorld();
      const key = [
        w.seq,
        time,
        c.selected,
        c.paths,
        c.daylight,
        c.roofMode,
        c.quality,
        c.cameraMode,
      ].join(':');
      // A disconnected/faulted server can leave status=running at a frozen head.
      if (!keys.size && !needsRender && key === renderedKey)
        return;
      renderedKey = key;
      needsRender = false;
      const daylight = c.daylight
        ? 1
        : Math.max(0, Math.sin((((time / DAY) % 1) - 0.25) * Math.PI * 2));
      hemi.intensity = 0.7 + daylight * 0.8;
      sun.intensity = 0.35 + daylight * 2.5;
      sun.color.set(daylight > 0.5 ? 0xffe1ac : 0xa4b7d3);
      const sky = new T.Color(0x5f7681).lerp(new T.Color(0xb8c9c3), daylight);
      (scene.background as T.Color).copy(sky);
      (scene.fog as T.FogExp2).color.copy(sky);
      sun.position.set(c.daylight ? 70 : 130 + Math.cos((time / DAY) * Math.PI * 2) * 80, 150, 35);
      if (now - lastShadow > 1500) {
        renderer.shadowMap.needsUpdate = true;
        lastShadow = now;
      }
      if (c.quality !== qualityValue) {
        qualityValue = c.quality;
        mount.dataset.quality = c.quality;
        renderer.setPixelRatio(c.quality === 'high' ? Math.min(devicePixelRatio, 1.5) : 0.7);
        renderer.shadowMap.enabled = c.quality === 'high';
      }
      for (const [id, model] of actors)
        if (!w.agents.some((a) => a.id === id)) {
          model.root.visible = false;
          dom.get(id)!.style.display = 'none';
        }
      for (const a of w.agents) {
        if (!actors.has(a.id)) addActor(a);
        const model = actors.get(a.id)!;
        const p = position(a, time),
          future = position(a, time + 3000),
          inside = layout.some(
            (b) => Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.d / 2,
          );
        model.root.position.set(p.x, inside ? 0.7 : 0, p.y);
        if (Math.hypot(future.x - p.x, future.y - p.y) > 0.001) {
          const angle = Math.atan2(future.x - p.x, future.y - p.y);
          const delta = Math.atan2(
            Math.sin(angle - model.root.rotation.y),
            Math.cos(angle - model.root.rotation.y),
          );
          model.root.rotation.y += delta * Math.min(1, dt * 12);
        }
        model.animate(a, time / SPEED / 1000, a.id === c.selected);
        const label = dom.get(a.id)!,
          screen = new T.Vector3(p.x, inside ? 5.5 : 4.6, p.y).project(camera);
        const hidden =
          a.away ||
          screen.z > 1 ||
          screen.z < -1 ||
          Math.abs(screen.x) > 1 ||
          Math.abs(screen.y) > 1 ||
          (inside && a.id !== c.selected && !c.roofMode);
        model.root.visible = !a.away && !(inside && a.id !== c.selected && !c.roofMode);
        label.style.display = hidden ? 'none' : 'block';
        label.style.transform = `translate(${(screen.x * 0.5 + 0.5) * viewportWidth}px,${(-screen.y * 0.5 + 0.5) * viewportHeight}px) translate(-50%,-100%)`;
        label.classList.toggle('selected', a.id === c.selected);
        const speech = a.voice?.text ?? '';
        const caption = `${a.name}${a.thinking ? ' · ◌' : a.dead ? ' · †' : ''}`;
        const textKey = `${caption}\n${speech}`;
        if (labelText.get(a.id) !== textKey) {
          labelText.set(a.id, textKey);
          label.querySelector('span')!.textContent = speech;
          label.querySelector('span')!.style.display = speech ? 'block' : 'none';
          label.querySelector('button')!.textContent = caption;
        }
      }
      const a = w.agents.find((a) => a.id === c.selected),
        p = a && position(a, time);
      if (c.cameraMode === 'follow' && p) {
        const target = new T.Vector3(p.x, 1, p.y);
        if (lastFollow !== a!.id) {
          camera.position.copy(target).add(new T.Vector3(22, 20, 32));
          controls.target.copy(target);
          lastFollow = a!.id;
        } else {
          const delta = target
            .clone()
            .sub(controls.target)
            .multiplyScalar(Math.min(1, dt * 4));
          camera.position.add(delta);
          controls.target.add(delta);
        }
      } else lastFollow = undefined;
      for (const b of layout) {
        const inside = p && Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.d / 2;
        roofs.get(b.id)!.visible = !c.roofMode && !inside;
      }
      for (const f of w.fields) {
        const crop = crops.get(f.id)!;
        const growth = Math.max(
          0.2,
          Math.min(1, (((time / DAY) % 30) / 30) * 0.5 + (f.work / f.required) * 0.5),
        );
        crop.scale.y = f.harvest > 0 ? 1.1 : growth;
      }
      for (const g of w.gates) {
        const canPass =
          g.open ||
          w.agents.some(
            (a) =>
              !a.dead &&
              a.keys.includes(g.key) &&
              Math.hypot(position(a, time).x - g.x, position(a, time).y - g.y) < 12,
          );
        const door = gates.get(g.id)!;
        door.rotation.y = T.MathUtils.damp(door.rotation.y, canPass ? -Math.PI * 0.48 : 0, 5, dt);
      }
      for (const s of smokes) {
        const age = ((time / SPEED / 1000) * 0.1 + s.offset) % 1;
        s.sprite.position
          .copy(s.origin)
          .add(new T.Vector3(age * 5, age * 10, Math.sin(age * 3) * 1.7));
        s.sprite.scale.setScalar(2 + age * 5);
        (s.sprite.material as T.SpriteMaterial).opacity = (1 - age) * 0.24;
      }
      const motionKey = `${a?.motion?.start}:${a?.motion?.end}:${a?.task?.target}:${a?.planVersion}`;
      if (pathMotion !== motionKey || pathAgent !== c.selected) {
        pathMotion = motionKey;
        pathAgent = c.selected;
        path.geometry.dispose();
        const pts = a?.motion?.points.map((p) => new T.Vector3(p.x, 0.3, p.y)) ?? [];
        path.geometry = new T.BufferGeometry().setFromPoints(pts);
        path.computeLineDistances();
      }
      path.visible = c.paths && !!a?.motion;
      const goal = w.sites.find((s) => s.id === a?.task?.target);
      targetRing.visible = !!goal && c.paths;
      if (goal) targetRing.position.set(goal.x, 0.25, goal.y);
      if (keys.size) {
        const velocity = camera.position.distanceTo(controls.target) * dt * 0.45,
          forward = camera.getWorldDirection(new T.Vector3());
        // Pan on the ground plane in the camera's current heading.
        forward.y = 0;
        forward.normalize();
        const right = new T.Vector3().crossVectors(forward, camera.up).normalize(),
          delta = forward
            .multiplyScalar((keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0))
            .addScaledVector(right, (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0))
            .normalize()
            .multiplyScalar(velocity);
        controls.target.add(delta);
        camera.position.add(delta);
      }
      controls.update();
      renderer.render(scene, camera);
      mount.dataset.renderedFrames = String(++totalFrames);
      frameCount++;
      if (now - lastMini > 200) {
        lastMini = now;
        const ctx = minimap.getContext('2d')!,
          ww = w.size.w * TILE,
          hh = w.size.h * TILE,
          sx = 160 / ww,
          sz = 132 / hh;
        ctx.fillStyle = '#344a39';
        ctx.fillRect(0, 0, 160, 132);
        for (const f of w.fields) {
          ctx.fillStyle = '#a6985b';
          ctx.fillRect((f.x - 7) * sx, (f.y - 7) * sz, 14 * sx, 14 * sz);
        }
        for (const b of layout) {
          ctx.fillStyle = '#dbcba3';
          ctx.fillRect((b.x - b.w / 2) * sx, (b.y - b.d / 2) * sz, b.w * sx, b.d * sz);
        }
        ctx.strokeStyle = '#96a387';
        ctx.lineWidth = 1;
        for (const wall of w.walls)
          ctx.strokeRect((wall.x - 7.5) * sx, (wall.y - 7.5) * sz, 15 * sx, 15 * sz);
        for (const a of w.agents) {
          const p = position(a, time);
          ctx.fillStyle = a.id === c.selected ? '#ffe3a2' : '#c6d4ba';
          ctx.beginPath();
          ctx.arc(p.x * sx, p.y * sz, a.id === c.selected ? 3 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#e5ce94';
        ctx.strokeRect(controls.target.x * sx - 9, controls.target.z * sz - 7, 18, 14);
      }
      if (now - lastStats > 1000) {
        mount.dataset.fps = String(Math.round((frameCount * 1000) / (now - lastStats)));
        mount.dataset.drawCalls = String(renderer.info.render.calls);
        mount.dataset.triangles = String(renderer.info.render.triangles);
        frameCount = 0;
        lastStats = now;
      }
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      keys.clear();
      if (!document.hidden) {
        previous = performance.now();
        nextFrame = 0;
        needsRender = true;
        raf = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('dblclick', center);
      minimap.removeEventListener('click', onMini);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clearKeys);
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line) {
          o.geometry.dispose();
        }
      });
      smokeTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      layer.replaceChildren();
    };
  }, [frames]);
  return (
    <div className="cv-canvas game-canvas" ref={host}>
      <div className="game-labels" ref={labels} />
      <div className="game-camera-tools" aria-label="镜头控制">
        <button
          onClick={() => {
            setCameraMode('village');
            commands.current.reset();
          }}
        >
          全景
        </button>
        <button
          aria-pressed={cameraMode === 'follow'}
          onClick={() => setCameraMode(cameraMode === 'follow' ? 'village' : 'follow')}
        >
          跟随居民
        </button>
        <button onClick={() => commands.current.focus()}>近看</button>
        <button aria-pressed={!daylight} onClick={() => setDaylight(!daylight)}>
          昼夜光照
        </button>
        <button aria-pressed={roofMode} onClick={() => setRoofMode(!roofMode)}>
          剖开屋顶
        </button>
        <button onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}>
          {quality === 'high' ? '精细画质' : '流畅画质'}
        </button>
      </div>
      <div className="game-minimap">
        <span>领地地图</span>
        <canvas ref={mini} width="160" height="132" aria-label="村庄小地图，点击移动镜头" />
        <small>点击定位 · W A S D 平移</small>
      </div>
      <div className="game-compass">
        N <span>✧</span>
      </div>
      {error && (
        <div className="cv-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
