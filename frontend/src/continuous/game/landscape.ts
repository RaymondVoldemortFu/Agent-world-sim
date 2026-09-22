import * as T from 'three';
import { TILE, type World } from '../types';
import { buildings, wallSegments } from './space';
import {
  bake,
  box,
  beam,
  mat,
  mesh,
  tree,
  wellArt,
  wagon,
  barrel,
  sack,
  bench,
  fence,
  cylinder,
} from './models';
export const noise = (x: number, z: number) => {
  const a = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return a - Math.floor(a);
};
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
export function landscape(w: World) {
  const group = new T.Group(),
    props = new T.Group(),
    width = w.size.w * TILE,
    depth = w.size.h * TILE;
  const groundGeo = new T.PlaneGeometry(width + 180, depth + 160, 100, 100);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(width / 2, -0.06, depth / 2);
  const p = groundGeo.attributes.position,
    colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      edge = Math.max(0, -x, x - width, -z, z - depth),
      n = noise(Math.floor(x / 4), Math.floor(z / 4));
    p.setY(
      i,
      -0.12 +
        Math.sin(x * 0.07) * Math.cos(z * 0.08) * 0.15 +
        Math.min(10, edge * 0.1) * Math.sin(x * 0.025 + z * 0.037),
    );
    const c = new T.Color().setHSL(0.24 + n * 0.018, 0.39 + n * 0.08, 0.19 + n * 0.045);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = mesh(groundGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.castShadow = false;
  group.add(ground);
  const roadMaterial = mat(0xb4a27c),
    roadEdge = mat(0x9a916c);
  function path(a: { x: number; y: number }, b: { x: number; y: number }, wide = 4.5) {
    const length = Math.hypot(a.x - b.x, a.y - b.y),
      m = box(
        props,
        wide,
        0.12,
        length + wide,
        (a.x + b.x) / 2,
        0.03,
        (a.y + b.y) / 2,
        roadMaterial,
      );
    m.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
    for (let i = 0; i < Math.ceil(length / 1.8); i++) {
      const f = i / Math.ceil(length / 1.8),
        x = a.x + (b.x - a.x) * f,
        z = a.y + (b.y - a.y) * f;
      for (const sign of [-1, 1]) {
        const nx = ((b.y - a.y) / length) * sign,
          nz = (-(b.x - a.x) / length) * sign;
        const s = box(
          props,
          0.8,
          0.13,
          0.65,
          x + nx * (wide / 2 + 0.25),
          0.12,
          z + nz * (wide / 2 + 0.25),
          roadEdge,
        );
        s.rotation.y = noise(x, z) * 2;
      }
    }
  }
  for (const a of w.roads)
    for (const b of w.roads)
      if ((b.x === a.x + TILE && b.y === a.y) || (b.y === a.y + TILE && b.x === a.x)) path(a, b);
  const plaza = w.sites.find((s) => s.id === 'plaza')!;
  for (let x = -8; x <= 8; x += 1.2)
    for (let z = -8; z <= 8; z += 1.2)
      if (x * x + z * z < 78) {
        const s = box(
          props,
          1.1,
          0.13,
          1.1,
          plaza.x + x,
          0.15,
          plaza.y + z,
          noise(x, z) > 0.4 ? 0xb1ab8d : 0x969882,
        );
        s.rotation.y = noise(z, x) * 0.16;
      }
  for (const b of buildings(w)) {
    const door = { x: b.x, y: b.y + b.d / 2 + 2 },
      road = w.roads.reduce((a, c) =>
        Math.hypot(c.x - door.x, c.y - door.y) < Math.hypot(a.x - door.x, a.y - door.y) ? c : a,
      );
    path(door, road, 3.6);
  }
  // Pastoral fringe: trees are placed clear of navigable village destinations.
  for (let i = 0; i < 135; i++) {
    const x = -48 + noise(i, 2) * (width + 96),
      z = -40 + noise(i, 7) * (depth + 80);
    const outside = x < 5 || x > width - 5 || z < 5 || z > depth - 5;
    if (!outside) continue;
    tree(props, x, z, i, 1 + noise(i, 1) * 0.6);
  }
  for (const [x, z, s] of w.manor
    ? []
    : [
        [28, 40, 1.3],
        [37, 170, 1],
        [145, 40, 1.2],
        [242, 153, 1.3],
        [225, 204, 1.2],
        [110, 217, 1],
      ])
    tree(props, x, z, Math.floor(x), s);
  tree(props, plaza.x + 8, plaza.y - 11, 12, 1.1);
  bench(props, plaza.x + 5, plaza.y - 7, 0.25);
  bench(props, plaza.x - 7, plaza.y, Math.PI / 2);
  const well = w.sites.find((s) => s.kind === 'well')!;
  const wellMesh = wellArt();
  wellMesh.position.set(well.x, 0, well.y);
  group.add(wellMesh);
  wagon(props, plaza.x - 18, plaza.y + 13);
  barrel(props, plaza.x - 15, 0, plaza.y + 16);
  sack(props, plaza.x - 13, 0, plaza.y + 16);
  // A modest market canopy and stacked supplies at the gathering place.
  const stall = new T.Group();
  for (const x of [-3, 3])
    for (const z of [-1.8, 1.8]) box(stall, 0.16, 4.2, 0.16, x, 2.1, z, 0x654c31);
  for (let i = 0; i < 8; i++) {
    const c = box(stall, 0.83, 0.14, 4.6, -2.9 + i * 0.83, 4.25, 0, i % 2 ? 0xc0b38e : 0x896c54);
    c.rotation.x = 0.12;
  }
  box(stall, 6, 0.25, 1.4, 0, 1.7, 0, 0x886a43);
  for (let i = 0; i < 4; i++) sack(stall, -2 + i * 1.1, 1.83, 0, 0.5);
  stall.position.set(plaza.x + 13, 0, plaza.y + 3);
  props.add(stall);
  if (w.manor) {
    const tax = w.sites.find((s) => s.id === 'royal-tax-store')!;
    for (const sign of [-1, 1]) box(props, 0.25, 4, 0.25, tax.x + sign * 3, 2, tax.y - 2, 0x57412e);
    box(props, 7, 0.25, 5, tax.x, 4.1, tax.y, 0x6f5865);
    for (let i = 0; i < 5; i++) sack(props, tax.x - 2 + i, 0, tax.y + 0.8, 0.8);
    box(props, 4.5, 1.5, 2, tax.x, 0.75, tax.y - 1, 0x80623d);
    box(props, 0.7, 1.55, 2.05, tax.x, 0.8, tax.y - 1, 0x58656b);
    const board = w.sites.find((s) => s.id === 'plaza-board')!;
    for (const sign of [-1, 1])
      box(props, 0.2, 3, 0.2, board.x + sign * 1.5, 1.5, board.y - 3, 0x654b31);
    box(props, 3.5, 1.8, 0.2, board.x, 2.4, board.y - 3, 0xb7a078);
    for (let i = 0; i < 4; i++)
      box(props, 2.5, 0.04, 0.02, board.x, 2.9 - i * 0.3, board.y - 2.88, 0x715b42);
  }
  // Fine meadow detail as shared instanced geometry.
  const grassGeo = new T.ConeGeometry(0.09, 0.55, 3),
    grass = new T.InstancedMesh(grassGeo, mat(0x8f995b), 2200),
    matrix = new T.Matrix4();
  for (let i = 0; i < 2200; i++) {
    const x = noise(i, 33) * width,
      z = noise(i, 44) * depth;
    matrix.compose(
      v(x, 0.18, z),
      new T.Quaternion().setFromAxisAngle(v(0, 1, 0), noise(i, 3) * 6.28),
      v(1, noise(i, 4) + 0.45, 1),
    );
    grass.setMatrixAt(i, matrix);
  }
  grass.castShadow = false;
  grass.receiveShadow = true;
  group.add(grass);
  for (const { a, b } of wallSegments(w)) {
    const len = Math.hypot(a.x - b.x, a.y - b.y),
      horizontal = Math.abs(a.x - b.x) > 0.1,
      angle = horizontal ? Math.PI / 2 : 0;
    const segment = new T.Group();
    box(segment, 1.45, 4.8, len, 0, 2.4, 0, 0x969b89);
    for (let row = 0; row < 7; row++)
      for (let k = 0; k < Math.ceil(len / 1.8); k++)
        for (const side of [-1, 1])
          box(
            segment,
            0.14,
            0.55,
            1.65,
            side * 0.8,
            0.4 + row * 0.66,
            -len / 2 + 0.9 + k * 1.8 + (row % 2) * 0.14,
            (k + row) % 3 ? 0xa9ac97 : 0x858e80,
          );
    box(segment, 1.85, 0.25, len, 0, 4.88, 0, 0xb6b6a1);
    for (let z = -len / 2 + 0.4; z < len / 2; z += 2.1)
      box(segment, 1.7, 0.9, 0.95, 0, 5.45, z, 0xaeb09c);
    segment.position.set((a.x + b.x) / 2, 0, (a.y + b.y) / 2);
    segment.rotation.y = angle;
    props.add(segment);
  }
  for (const g of w.gates)
    for (const z of [-4.2, 4.2]) {
      box(props, 3, 7.5, 2.2, g.x, 3.75, g.y + z, 0x9ea58f);
      box(props, 3.5, 0.4, 2.6, g.x, 7.65, g.y + z, 0xb4b6a0);
      for (const dx of [-1, 1]) box(props, 0.6, 0.8, 2.4, g.x + dx, 8.1, g.y + z, 0x939b89);
    }
  // Fences frame cultivation, leaving the paths and plot centers accessible.
  const minX = Math.min(...w.fields.map((f) => f.x)) - 7.5,
    maxX = Math.max(...w.fields.map((f) => f.x)) + 7.5;
  const minZ = Math.min(...w.fields.map((f) => f.y)) - 7.5,
    maxZ = Math.max(...w.fields.map((f) => f.y)) + 7.5;
  fence(props, v(minX, 0, maxZ + 1.5), v(maxX, 0, maxZ + 1.5));
  fence(props, v(maxX + 1.5, 0, minZ), v(maxX + 1.5, 0, maxZ));
  // River beyond the western navigation boundary, with a soft reflective ribbon.
  const river = new T.PlaneGeometry(17, depth + 150, 3, 75);
  river.rotateX(-Math.PI / 2);
  const rp = river.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const z = rp.getZ(i) + depth / 2;
    rp.setXYZ(i, rp.getX(i) - 24 + Math.sin(z * 0.025) * 5, -0.08, z);
  }
  river.computeVertexNormals();
  const water = mesh(
    river,
    new T.MeshStandardMaterial({ color: 0x668b87, roughness: 0.26, metalness: 0.25 }),
  );
  water.castShadow = false;
  group.add(water);
  for (let i = 0; i < 26; i++) {
    const z = i * 11 - 20;
    const rock = mesh(
      new T.DodecahedronGeometry(1.5 + noise(i, 1), 0),
      0x969889,
      -35 + Math.sin(z * 0.025) * 5,
      0.5,
      z,
    );
    rock.scale.y = 0.5;
    props.add(rock);
  }
  group.add(bake(props));
  return { group, water };
}
export function fieldArt(x: number, z: number, seed: number) {
  const g = new T.Group();
  box(g, 13.7, 0.12, 13.7, 0, 0.07, 0, 0x756041);
  for (let i = 0; i < 10; i++)
    box(g, 0.36, 0.15, 13.2, -6 + i * 1.32, 0.16, 0, i % 2 ? 0x8b7250 : 0x66543c);
  const soil = bake(g),
    stems = new T.Group();
  for (let row = 0; row < 9; row++)
    for (let col = 0; col < 13; col++) {
      const px = -5.7 + row * 1.35 + (noise(row, col + seed) - 0.5) * 0.24,
        pz = -6 + col;
      const h = 1.1 + noise(row + seed, col) * 0.65;
      cylinder(stems, 0.045, h, px, h / 2, pz, 0xaab36a, 0.025, 3);
      for (let k = 0; k < 3; k++) {
        const stalk = mesh(
          new T.ConeGeometry(0.13, 0.42, 4),
          0xc6ae65,
          px + 0.05 * (k - 1),
          h - 0.12 + k * 0.17,
          pz,
        );
        stalk.rotation.z = (k - 1) * 0.35;
        stems.add(stalk);
      }
      for (const sign of [-1, 1]) {
        const leaf = box(stems, 0.5, 0.025, 0.08, px + sign * 0.17, h * 0.55, pz, 0x8e9f54);
        leaf.rotation.z = sign * 0.6;
      }
    }
  const crop = bake(stems),
    root = new T.Group();
  root.add(soil, crop);
  root.position.set(x, 0, z);
  return { root, crop };
}
