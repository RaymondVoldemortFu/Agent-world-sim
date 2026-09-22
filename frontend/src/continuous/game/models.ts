import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building } from './space';

const materials = new Map<string, T.MeshStandardMaterial>();
const vertexMaterials = new Map<number, T.MeshStandardMaterial>();
function packColor(geometry: T.BufferGeometry, material: T.Material): T.Material {
  if (
    !(material instanceof T.MeshStandardMaterial) ||
    material.transparent ||
    (material.emissiveIntensity > 0 && material.emissive.getHex() !== 0)
  )
    return material;
  const count = geometry.getAttribute('position').count,
    colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = material.color.r;
    colors[i * 3 + 1] = material.color.g;
    colors[i * 3 + 2] = material.color.b;
  }
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  if (!vertexMaterials.has(material.roughness))
    vertexMaterials.set(
      material.roughness,
      new T.MeshStandardMaterial({ vertexColors: true, roughness: material.roughness }),
    );
  return vertexMaterials.get(material.roughness)!;
}
export function mat(color: number, roughness = 0.86, emissive = 0) {
  const k = `${color}:${roughness}:${emissive}`;
  if (!materials.has(k))
    materials.set(
      k,
      new T.MeshStandardMaterial({
        color,
        roughness,
        emissive: emissive ? color : 0,
        emissiveIntensity: emissive,
      }),
    );
  return materials.get(k)!;
}
const P = {
  plaster: 0xe2d5b1,
  stone: 0x9f9c83,
  stone2: 0xb6af95,
  wood: 0x5a3c26,
  oak: 0x8b653d,
  dark: 0x352e26,
  roof: 0xa85937,
  iron: 0x464a43,
};
export function mesh(geometry: T.BufferGeometry, color: number | T.Material, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geometry, typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export function box(
  g: T.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number | T.Material,
) {
  const m = mesh(new T.BoxGeometry(w, h, d), color, x, y, z);
  g.add(m);
  return m;
}
export function cylinder(
  g: T.Group,
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: number | T.Material,
  top = r,
  segments = 10,
) {
  const m = mesh(new T.CylinderGeometry(top, r, h, segments), color, x, y, z);
  g.add(m);
  return m;
}
export function ball(g: T.Group, r: number, x: number, y: number, z: number, color: number) {
  const m = mesh(new T.IcosahedronGeometry(r, 1), color, x, y, z);
  g.add(m);
  return m;
}
export function beam(g: T.Group, a: T.Vector3, b: T.Vector3, width: number, color: number) {
  const m = mesh(new T.BoxGeometry(width, a.distanceTo(b), width), color);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.add(m);
  return m;
}
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
/** Bake static pieces by material: individual shingles remain geometry, not individual draw calls. */
export function bake(g: T.Group) {
  g.updateMatrixWorld(true);
  const bins = new Map<T.Material, T.BufferGeometry[]>();
  g.traverse((o) => {
    if (o instanceof T.Mesh && !Array.isArray(o.material)) {
      let geo = o.geometry.clone();
      if (geo.index) geo = geo.toNonIndexed();
      geo.applyMatrix4(o.matrixWorld);
      geo.deleteAttribute('uv');
      const material = packColor(geo, o.material);
      const list = bins.get(material) ?? [];
      list.push(geo);
      bins.set(material, list);
    }
  });
  const result = new T.Group();
  for (const [material, list] of bins) {
    const geo = mergeGeometries(list, false);
    if (geo) {
      const m = mesh(geo, material);
      result.add(m);
    }
    for (const geo of list) geo.dispose();
  }
  g.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
  return result;
}
export function barrel(g: T.Group, x: number, y: number, z: number, scale = 1) {
  const body = cylinder(
    g,
    0.72 * scale,
    1.65 * scale,
    x,
    y + 0.825 * scale,
    z,
    P.oak,
    0.62 * scale,
    12,
  );
  for (const dy of [0.22, 0.8, 1.38])
    cylinder(g, 0.74 * scale, 0.09 * scale, x, y + dy * scale, z, P.iron, 0.74 * scale, 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    beam(
      g,
      v(x + Math.sin(a) * 0.7 * scale, y + 0.1, z + Math.cos(a) * 0.7 * scale),
      v(x + Math.sin(a) * 0.6 * scale, y + 1.6 * scale, z + Math.cos(a) * 0.6 * scale),
      0.035 * scale,
      P.dark,
    );
  }
  return body;
}
export function sack(g: T.Group, x: number, y: number, z: number, scale = 1) {
  const a = ball(g, 0.72 * scale, x, y + 0.65 * scale, z, 0xc7b38a);
  a.scale.set(0.8, 1.1, 0.7);
  cylinder(g, 0.22 * scale, 0.2 * scale, x, y + 1.36 * scale, z, P.wood);
}
export function wagon(g: T.Group, x: number, z: number) {
  box(g, 4, 0.3, 2.4, x, 1.5, z, P.oak);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) box(g, 4, 0.27, 0.16, x, 1.7 + i * 0.35, z + side * 1.2, P.oak);
    for (const dx of [-1.35, 1.35]) {
      const wheel = mesh(new T.TorusGeometry(0.9, 0.12, 6, 16), P.dark, x + dx, 1, z + side * 1.45);
      g.add(wheel);
      for (let a = 0; a < 6; a++)
        beam(
          g,
          v(x + dx, 1, z + side * 1.45),
          v(
            x + dx + Math.sin((a * Math.PI) / 3) * 0.85,
            1 + Math.cos((a * Math.PI) / 3) * 0.85,
            z + side * 1.45,
          ),
          0.065,
          P.oak,
        );
    }
  }
  for (const dz of [-0.65, 0.65])
    beam(g, v(x + 2, 1.35, z + dz), v(x + 5, 1, z + dz), 0.15, P.wood);
  sack(g, x, 1.65, z);
  sack(g, x - 1.2, 1.65, z, 0.7);
}
function windowArt(g: T.Group, x: number, y: number, z: number, side = 0) {
  const group = new T.Group();
  box(group, 1.35, 1.9, 0.13, 0, 0, 0, P.dark);
  box(group, 1.07, 1.58, 0.17, 0, 0, 0.03, mat(0xf0c16f, 0.4, 0.28));
  box(group, 0.1, 1.8, 0.22, 0, 0, 0.08, P.wood);
  box(group, 1.3, 0.1, 0.22, 0, 0, 0.08, P.wood);
  for (const dx of [-0.84, 0.84]) {
    box(group, 0.32, 1.9, 0.18, dx, 0, 0.14, 0x667d64);
    for (let i = 0; i < 6; i++) box(group, 0.32, 0.045, 0.2, dx, -0.75 + i * 0.3, 0.16, P.dark);
  }
  box(group, 1.8, 0.2, 0.6, 0, -1.08, 0.15, P.oak);
  group.rotation.y = side;
  group.position.set(x, y, z);
  g.add(group);
}
export function buildingArt(b: Building, seed: number) {
  const root = new T.Group(),
    roof = new T.Group(),
    h = b.height,
    w = b.w,
    d = b.d;
  box(root, w + 1, 0.7, d + 1, 0, 0.25, 0, P.stone);
  // Stone plinth and plaster walls, with a real open entrance.
  box(root, 1, h, d, -w / 2, h / 2, 0, P.plaster);
  box(root, 1, h, d, w / 2, h / 2, 0, P.plaster);
  box(root, w, h, 1, 0, h / 2, -d / 2, P.plaster);
  const wing = (w - b.door) / 2;
  for (const sign of [-1, 1])
    box(root, wing, h, 1, sign * (b.door / 2 + wing / 2), h / 2, d / 2, P.plaster);
  box(root, b.door, h - 3.6, 1, 0, 3.6 + (h - 3.6) / 2, d / 2, P.plaster);
  for (const z of [-d / 2 - 0.56, d / 2 + 0.56]) {
    for (let x = -w / 2; x <= w / 2 + 0.1; x += 2.6) {
      for (let j = 0; j < 2; j++)
        if (z < 0 || Math.abs(x) > b.door / 2 + 0.6)
          box(
            root,
            2.3,
            0.65,
            0.2,
            x,
            0.65 + j * 0.72,
            z,
            (j + Math.round(x)) % 2 ? P.stone : P.stone2,
          );
    }
    for (const y of [2.1, h * 0.57, h - 0.15]) {
      if (z < 0 || y > 3.6) box(root, w + 0.25, 0.28, 0.3, 0, y, z, P.wood);
      else
        for (const s of [-1, 1])
          box(root, wing, 0.28, 0.3, s * (b.door / 2 + wing / 2), y, z, P.wood);
    }
    for (let x = -w / 2; x <= w / 2 + 0.1; x += w / 4) {
      if (z > 0 && Math.abs(x) < b.door / 2) continue;
      box(root, 0.32, h, 0.35, x, h / 2, z, P.wood);
    }
    for (const sign of [-1, 1])
      beam(
        root,
        v(sign * (w / 2 - 0.3), 2.3, z + 0.1),
        v(sign * (w / 4 + 0.2), h - 0.4, z + 0.1),
        0.2,
        P.wood,
      );
  }
  for (const x of [-w / 2 - 0.56, w / 2 + 0.56])
    for (const z of [-d / 2, 0, d / 2]) box(root, 0.35, h, 0.3, x, h / 2, z, P.wood);
  for (const sign of [-1, 1])
    for (const z of [-d / 2, d / 2])
      beam(root, v((sign * w) / 2, h, z), v((sign * w) / 2, h + 4.5, 0), 0.4, P.wood);
  // Gables are triangular walls beneath a pitched tile roof.
  const rise = b.kind === 'hall' ? 6 : 4.5;
  for (const x of [-w / 2, w / 2]) {
    const geo = new T.BufferGeometry();
    geo.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [x, h, -d / 2, x, h, d / 2, x, h + rise, 0, x, h, d / 2, x, h, -d / 2, x, h + rise, 0],
        3,
      ),
    );
    geo.computeVertexNormals();
    root.add(mesh(geo, P.plaster));
    beam(root, v(x, h, -d / 2), v(x, h + rise, 0), 0.32, P.wood);
    beam(root, v(x, h, d / 2), v(x, h + rise, 0), 0.32, P.wood);
    beam(root, v(x, h, 0), v(x, h + rise, 0), 0.25, P.wood);
  }
  const slope = Math.atan2(rise, d / 2),
    length = Math.hypot(rise, d / 2) + 1.2;
  for (const sign of [-1, 1]) {
    const panel = box(roof, w + 2, 0.25, length, 0, h + rise / 2, (sign * d) / 4, P.dark);
    panel.rotation.x = sign * slope;
    const tileGroup = new T.Group();
    tileGroup.position.copy(panel.position);
    tileGroup.rotation.x = panel.rotation.x;
    const nx = Math.ceil((w + 2) / 1.15),
      nz = Math.ceil(length / 0.85);
    for (let row = 0; row < nz; row++)
      for (let col = 0; col < nx; col++) {
        const tones =
          b.kind === 'hall'
            ? [0x667d87, 0x7b9296, 0x526b77]
            : [0xa96740, 0xb57747, 0xaf6c40, 0x99603b];
        box(
          tileGroup,
          1.1,
          0.13,
          0.92,
          (col - (nx - 1) / 2) * 1.15 + (row % 2) * 0.15,
          0.22,
          (row - (nz - 1) / 2) * 0.85,
          tones[
            Math.abs(Math.floor(Math.sin(row * 17.3 + col * 91.7 + seed) * 43758)) % tones.length
          ],
        );
      }
    roof.add(tileGroup);
  }
  beam(roof, v(-w / 2 - 1, h + rise + 0.25, 0), v(w / 2 + 1, h + rise + 0.25, 0), 0.38, P.oak);
  for (let x = -w / 2; x <= w / 2; x += 1.05) {
    const cap = cylinder(
      roof,
      0.26,
      1,
      x,
      h + rise + 0.32,
      0,
      b.kind === 'hall' ? 0x8b9999 : P.roof,
      0.26,
      8,
    );
    cap.rotation.z = Math.PI / 2;
  }
  for (const x of [-w * 0.3, w * 0.3]) windowArt(root, x, h * 0.67, d / 2 + 0.55);
  for (const z of [-d * 0.25, d * 0.25]) windowArt(root, w / 2 + 0.55, h * 0.64, z, Math.PI / 2);
  // Hinged door, iron straps, doorstep and flowering planters.
  for (const sign of [-1, 1])
    box(root, 0.34, 3.9, 0.42, sign * (b.door / 2 + 0.1), 1.95, d / 2 + 0.3, P.wood);
  box(root, b.door + 0.5, 0.3, 0.42, 0, 3.7, d / 2 + 0.3, P.wood);
  const door = new T.Group();
  box(door, b.door * 0.85, 3.4, 0.17, b.door * 0.425, 1.7, 0, P.oak);
  for (const y of [0.6, 2.5]) box(door, b.door * 0.82, 0.12, 0.23, b.door * 0.425, y, 0, P.iron);
  door.position.set(-b.door / 2, 0, d / 2);
  door.rotation.y = -1.25;
  root.add(door);
  for (let i = 0; i < 2; i++)
    box(root, b.door + 1 + i * 0.6, 0.2, 1.2, 0, 0.15 - i * 0.06, d / 2 + 0.7 + i * 0.65, P.stone2);
  for (const sign of [-1, 1]) {
    const x = sign * w * 0.34;
    box(root, 2.5, 0.65, 0.9, x, 1, d / 2 + 1, P.oak);
    for (let i = 0; i < 9; i++) {
      const px = x + ((i % 3) - 1) * 0.7,
        pz = d / 2 + 0.7 + Math.floor(i / 3) * 0.28;
      ball(root, 0.32, px, 1.5, pz, 0x627c43);
      ball(root, 0.12, px + 0.1, 1.85, pz, i % 2 ? 0xe9cb77 : 0xc38b96);
    }
  }
  const chimney = { x: -w * 0.3, y: h + rise + 1.2, z: -d * 0.2 };
  box(roof, 1.8, 5, 1.65, chimney.x, chimney.y - 1.7, chimney.z, P.stone);
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 2; i++)
      box(
        roof,
        0.8,
        0.37,
        0.08,
        chimney.x + (i - 0.5) * 0.86,
        chimney.y - 3.8 + j * 0.65,
        chimney.z + 0.86,
        j % 2 ? P.stone2 : P.stone,
      );
  box(roof, 2.15, 0.35, 2, chimney.x, chimney.y + 0.9, chimney.z, P.stone2);
  box(root, w - 1, 0.15, d - 1, 0, 0.65, 0, 0x8e7852);
  for (let i = 0; i < 5; i++) {
    barrel(root, -w / 2 + 2 + (i % 3) * 1.7, 0.7, -d / 2 + 2 + Math.floor(i / 3) * 2, 0.8);
  }
  box(root, 3.5, 0.3, 1.5, w * 0.22, 2.1, -d * 0.18, P.oak);
  for (const x of [w * 0.22 - 1.4, w * 0.22 + 1.4])
    for (const z of [-d * 0.18 - 0.5, -d * 0.18 + 0.5])
      box(root, 0.16, 1.4, 0.16, x, 1.4, z, P.wood);
  sack(root, w / 2 - 2, 0.7, d / 2 - 2);
  sack(root, w / 2 - 3.5, 0.7, d / 2 - 2, 0.8);
  return { body: bake(root), roof: bake(roof), chimney };
}
export function tree(g: T.Group, x: number, z: number, seed: number, scale = 1) {
  const h = (8 + (seed % 4)) * scale;
  cylinder(g, 0.48 * scale, h * 0.65, x, h * 0.32, z, 0x66503b, 0.23 * scale, 7);
  for (let i = 0; i < 4; i++) {
    const a = i * 2.4 + seed,
      xx = x + Math.sin(a) * 2.1 * scale,
      zz = z + Math.cos(a) * 2.1 * scale;
    beam(g, v(x, h * 0.4, z), v(xx, h * 0.82, zz), 0.23 * scale, 0x69533e);
    const m = ball(
      g,
      (2.8 + (i % 2) * 0.7) * scale,
      xx,
      h * (0.65 + i * 0.09),
      zz,
      [0x738348, 0x89944f, 0x536d42, 0x9a9c58][(seed + i) % 4],
    );
    m.scale.y = 0.85;
  }
}
export function wellArt() {
  const g = new T.Group();
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 12; i++) {
      const a = ((i + (j % 2) * 0.5) / 12) * Math.PI * 2,
        m = box(
          g,
          0.9,
          0.6,
          0.65,
          Math.sin(a) * 1.8,
          0.3 + j * 0.64,
          Math.cos(a) * 1.8,
          i % 2 ? P.stone : P.stone2,
        );
      m.rotation.y = a;
    }
  cylinder(g, 1.4, 0.08, 0, 0.45, 0, 0x3d6465);
  for (const x of [-2.25, 2.25]) box(g, 0.3, 5, 0.3, x, 2.5, 0, P.wood);
  beam(g, v(-2.5, 4.4, 0), v(2.5, 4.4, 0), 0.25, P.oak);
  cylinder(g, 0.035, 2.8, 0, 3, 0, P.wood);
  barrel(g, 0, 1, 0, 0.45);
  for (const s of [-1, 1]) {
    const r = box(g, 5.8, 0.2, 2.3, 0, 5.4, s * 0.7, P.roof);
    r.rotation.x = s * 0.48;
  }
  return bake(g);
}
export function fence(g: T.Group, a: T.Vector3, b: T.Vector3) {
  const count = Math.ceil(a.distanceTo(b) / 3);
  for (let i = 0; i <= count; i++) {
    const p = a.clone().lerp(b, i / count);
    box(g, 0.18, 1.65, 0.18, p.x, 0.8, p.z, P.oak);
  }
  for (const h of [0.55, 1.3])
    beam(g, new T.Vector3(a.x, h, a.z), new T.Vector3(b.x, h, b.z), 0.12, P.oak);
}
export function bench(g: T.Group, x: number, z: number, angle = 0) {
  const a = new T.Group();
  box(a, 3, 0.24, 0.85, 0, 1, 0, P.oak);
  for (const px of [-1.1, 1.1]) box(a, 0.25, 1, 0.6, px, 0.5, 0, P.wood);
  a.position.set(x, 0, z);
  a.rotation.y = angle;
  g.add(a);
}

/** Merge only rigid mesh children; articulated groups retain their independent joints. */
export function mergeRigid(root: T.Group) {
  for (const child of [...root.children]) if (child instanceof T.Group) mergeRigid(child);
  const bins = new Map<T.Material, T.BufferGeometry[]>(),
    remove: T.Mesh[] = [];
  for (const child of root.children)
    if (child instanceof T.Mesh && !Array.isArray(child.material)) {
      child.updateMatrix();
      let g = child.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      g.applyMatrix4(child.matrix);
      g.deleteAttribute('uv');
      const material = packColor(g, child.material);
      const list = bins.get(material) ?? [];
      list.push(g);
      bins.set(material, list);
      remove.push(child);
    }
  for (const m of remove) {
    root.remove(m);
    m.geometry.dispose();
  }
  for (const [material, geometries] of bins) {
    const g = mergeGeometries(geometries);
    if (g) root.add(mesh(g, material));
    for (const geo of geometries) geo.dispose();
  }
}
