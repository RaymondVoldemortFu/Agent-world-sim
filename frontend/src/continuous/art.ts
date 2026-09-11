import { Container, Graphics } from 'pixi.js';
import type { Agent, Site } from './types';

// All architectural detail is drawn in local isometric 3D coordinates. Sources
// stay resolution-independent so close inspection retains stone/timber detail.
type V3 = [number, number, number];
const p = ([x, y, z]: V3) => [x - y, (x + y) * 0.5 - z];
const random = (x: number, y = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const poly = (g: Graphics, points: V3[], color: number, alpha = 1) =>
  g.poly(points.flatMap(p)).fill({ color, alpha });
const line = (g: Graphics, a: V3, b: V3, color: number, width = 1, alpha = 1) => {
  const aa = p(a),
    bb = p(b);
  g.moveTo(aa[0], aa[1]).lineTo(bb[0], bb[1]).stroke({ color, width, alpha });
};
function box(
  g: Graphics,
  x: number,
  y: number,
  z: number,
  l: number,
  d: number,
  h: number,
  c = [0xc6b99c, 0xa9997a, 0x817966],
) {
  poly(
    g,
    [
      [x, y + d, z],
      [x + l, y + d, z],
      [x + l, y + d, z + h],
      [x, y + d, z + h],
    ],
    c[1],
  );
  poly(
    g,
    [
      [x + l, y, z],
      [x + l, y + d, z],
      [x + l, y + d, z + h],
      [x + l, y, z + h],
    ],
    c[2],
  );
  poly(
    g,
    [
      [x, y, z + h],
      [x + l, y, z + h],
      [x + l, y + d, z + h],
      [x, y + d, z + h],
    ],
    c[0],
  );
}
function stone(
  g: Graphics,
  x: number,
  y: number,
  z: number,
  l: number,
  d: number,
  h: number,
  seed = 1,
) {
  box(g, x, y, z, l, d, h, [0xc3bc9d, 0xa5a38a, 0x828976]);
  for (const face of ['front', 'side'] as const) {
    const width = face === 'front' ? l : d;
    const at = (u: number, v: number): V3 =>
      face === 'front' ? [x + u, y + d, z + v] : [x + l, y + u, z + v];
    for (let row = 0; row < h / 5; row++)
      for (let col = -1; col < width / 9; col++) {
        const lo = Math.max(0, col * 9 + (row % 2) * 4),
          hi = Math.min(width, col * 9 + (row % 2) * 4 + 8.1);
        if (hi <= lo) continue;
        const low = row * 5 + 0.6,
          high = Math.min(h - 0.3, low + 4.1);
        const c = (
          face === 'front'
            ? [0xb3b098, 0xa8aa8e, 0xbbb69b, 0x9eaa8d]
            : [0x929a83, 0x83907b, 0x9aa18b, 0x7d8975]
        )[Math.floor(random(col + seed, row) * 4)];
        poly(g, [at(lo + 0.35, low), at(hi, low), at(hi, high), at(lo + 0.35, high)], c);
        line(g, at(lo + 0.35, high), at(hi, high), 0xe2d6b4, 0.6, 0.3);
      }
  }
}
function roof(
  g: Graphics,
  x: number,
  y: number,
  l: number,
  d: number,
  h: number,
  rise: number,
  slate = false,
) {
  const near = (u: number, v: number): V3 => [
    x + u,
    y + v,
    h + rise * (1 - Math.abs(v) / (d / 2 + 4)),
  ];
  // Far slope first, then the visible tiled slope and end bargeboard.
  poly(
    g,
    [near(-3, -d / 2 - 4), near(l + 3, -d / 2 - 4), near(l + 3, 0), near(-3, 0)],
    slate ? 0x556e73 : 0x835743,
  );
  const colors = slate
    ? [0x70868a, 0x7c9191, 0x667f85, 0x8c9b96]
    : [0xad7450, 0xb78157, 0x9e684a, 0xc08a5d];
  for (let row = 0; row < 7; row++) {
    const v0 = (row / 7) * (d / 2 + 4),
      v1 = ((row + 1) / 7) * (d / 2 + 4);
    for (let col = -1; col < Math.ceil((l + 6) / 7); col++) {
      const u0 = Math.max(-3, col * 7 + (row % 2) * 3.5),
        u1 = Math.min(l + 3, col * 7 + (row % 2) * 3.5 + 6.8);
      if (u1 <= u0) continue;
      poly(
        g,
        [near(u0, v0), near(u1, v0), near(u1, v1), near(u0, v1)],
        colors[Math.floor(random(col + 8, row) * 4)],
      );
      line(g, near(u0, v1), near(u1, v1), slate ? 0xb4bcb0 : 0xebbe83, 0.7, 0.55);
      line(g, near(u0, v0), near(u0, v1), 0x342e28, 0.55, 0.3);
    }
  }
  line(g, near(-3, 0), near(l + 3, 0), slate ? 0xa8b5ae : 0xdeb078, 3);
  line(g, near(-3, d / 2 + 4), near(l + 3, d / 2 + 4), 0x594b3b, 3);
  line(g, near(l + 3, -d / 2 - 4), near(l + 3, 0), 0xc4b28a, 2);
  line(g, near(l + 3, 0), near(l + 3, d / 2 + 4), 0xd1bd93, 2);
}
function barrel(g: Graphics, x: number, y: number, size = 1) {
  const [xx, yy] = p([x, y, 0]);
  g.ellipse(xx + 3, yy + 3, 8 * size, 3 * size).fill({ color: 0x283827, alpha: 0.22 });
  g.roundRect(xx - 5 * size, yy - 13 * size, 10 * size, 13 * size, 3 * size).fill(0x987042);
  g.ellipse(xx, yy - 12 * size, 5 * size, 2.3 * size)
    .fill(0xb4945d)
    .stroke({ color: 0x594d35, width: 0.7 });
  for (let i = -3; i <= 3; i += 3)
    g.moveTo(xx + i * size, yy - 10 * size)
      .lineTo(xx + i * size, yy - 2 * size)
      .stroke({ color: 0x644d32, width: 0.65 });
  for (const a of [-9, -3])
    g.moveTo(xx - 4.8 * size, yy + a * size)
      .quadraticCurveTo(xx, yy + (a + 2) * size, xx + 4.8 * size, yy + a * size)
      .stroke({ color: 0x4b5145, width: 1.5 * size });
}
function sack(g: Graphics, x: number, y: number) {
  const [xx, yy] = p([x, y, 0]);
  g.ellipse(xx, yy - 6, 5, 8).fill(0xc6b184);
  g.moveTo(xx - 2, yy - 11)
    .lineTo(xx + 3, yy - 12)
    .stroke({ color: 0x80704b, width: 1.3 });
  g.moveTo(xx + 2, yy - 8)
    .quadraticCurveTo(xx + 4, yy - 4, xx + 2, yy)
    .stroke({ color: 0xe0caa0, width: 1 });
}

export function architecture(
  kind: Site['kind'],
  variant = 0,
): { node: Container; roof?: Container } {
  const node = new Container(),
    g = new Graphics(),
    r = new Graphics(),
    roofs = new Container();
  node.addChild(g, roofs);
  roofs.addChild(r);
  if (kind === 'hall' || kind === 'home' || kind === 'workshop') {
    const hall = kind === 'hall',
      workshop = kind === 'workshop',
      l = hall ? 76 : workshop ? 54 : 48,
      d = hall ? 49 : 36,
      h = hall ? 57 : 36;
    const x = -l / 2,
      y = -d / 2;
    poly(
      g,
      [
        [x - 6, y, 0],
        [x + l + 28, y + 14, 0],
        [x + l + 28, y + d + 20, 0],
        [x, y + d + 9, 0],
      ],
      0x1c3025,
      0.3,
    );
    stone(g, x - 3, y - 3, -2, l + 6, d + 6, 7, variant);
    box(
      g,
      x,
      y,
      5,
      l,
      d,
      h - 5,
      hall ? [0xd4c7a5, 0xc1b291, 0xaca386] : [0xe0cfaa, 0xd3bd94, 0xa99b7b],
    );
    const front = (u: number, z: number): V3 => [x + u, y + d, z];
    const side = (u: number, z: number): V3 => [x + l, y + u, z];
    // Timber framing with recessed plaster panels, floor beam and diagonal braces.
    for (const [at, width] of [
      [front, l],
      [side, d],
    ] as const) {
      for (let u = 0; u <= width; u += width / 3) {
        line(g, at(u, 5), at(u, h), 0x675540, 3);
        line(g, at(u + 0.8, 6), at(u + 0.8, h - 1), 0xa58d63, 0.6);
      }
      for (const z of [7, h * 0.53, h - 1]) line(g, at(0, z), at(width, z), 0x675640, 3);
      for (let j = 0; j < 3; j++) {
        const u = (j * width) / 3;
        line(g, at(u + 1, 8), at(u + width / 3 - 1, h * 0.5), 0x786044, 2);
        if (hall) line(g, at(u + 1, h * 0.55), at(u + width / 3 - 1, h - 3), 0x786044, 2);
      }
      for (let i = 0; i < 18; i++) {
        const u = random(i, variant) * width,
          z = 8 + random(i + 29, variant) * (h - 14);
        line(g, at(u, z), at(Math.min(width, u + 2), z + 0.4), 0x8f8c67, 0.5, 0.2);
      }
    }
    // Two window bays with thick jambs, leaded glass and hinged wooden shutters.
    for (const u of [l * 0.19, l * 0.78]) {
      const z = hall ? 31 : 21,
        w = 5,
        height = hall ? 15 : 11;
      poly(
        g,
        [front(u - w, z - height), front(u + w, z - height), front(u + w, z), front(u - w, z)],
        0x4b5144,
      );
      poly(
        g,
        [
          front(u - w + 1, z - height + 1),
          front(u + w - 1, z - height + 1),
          front(u + w - 1, z - 1),
          front(u - w + 1, z - 1),
        ],
        0xc3b877,
        0.5,
      );
      line(g, front(u, z - height), front(u, z), 0x65573d, 1.2);
      line(g, front(u - w, z - height / 2), front(u + w, z - height / 2), 0x665840, 1);
      for (const off of [-8, 7]) {
        poly(
          g,
          [
            front(u + off, z - height),
            front(u + off + 3, z - height),
            front(u + off + 3, z),
            front(u + off, z),
          ],
          0x73816b,
        );
        line(g, front(u + off, z - 3), front(u + off + 3, z - 3), 0xb2b18b, 0.7);
      }
      line(g, front(u - w - 1, z - height - 1), front(u + w + 1, z - height - 1), 0xdecba3, 2);
      if (!hall) {
        box(g, x + u - 5, y + d + 1, z - height - 5, 10, 4, 4, [0xa68856, 0x8c754b, 0x6f663f]);
        for (let i = 0; i < 6; i++) {
          const [xx, yy] = p(front(u - 5 + i * 2, z - height + 1));
          g.circle(xx - 2, yy, 2).fill(i % 2 ? 0xa58575 : 0x748759);
        }
      }
    }
    // Portal has real visual depth, planked oak and forged hinges.
    const door = l * 0.47;
    poly(
      g,
      [front(door - 6, 5), front(door + 7, 5), front(door + 7, 25), front(door - 6, 25)],
      0x403c30,
    );
    for (let i = 0; i < 5; i++)
      poly(
        g,
        [
          front(door - 5 + i * 2.3, 6),
          front(door - 3 + i * 2.3, 6),
          front(door - 3 + i * 2.3, 23),
          front(door - 5 + i * 2.3, 23),
        ],
        i % 2 ? 0x8a6b45 : 0x9a784c,
      );
    for (const z of [10, 20]) line(g, front(door - 5, z), front(door + 6, z), 0x465047, 1.4);
    const handle = p(front(door + 3, 15));
    g.circle(handle[0], handle[1], 1.1).stroke({ color: 0xddb876, width: 0.8 });
    for (let i = 0; i < 3; i++)
      stone(g, x + door - 8, y + d + 2 + i * 3, 0, 18, 3, 5 - i, variant + 5);
    // Visible gable wall, king post and roof overhang.
    poly(
      g,
      [
        [x + l, y, h],
        [x + l, y + d, h],
        [x + l, 0, h + 29],
      ],
      0xc9bb94,
    );
    line(g, [x + l, 0, h], [x + l, 0, h + 27], 0x6d5a42, 3);
    line(g, [x + l, y, h], [x + l, y + d, h], 0x69543a, 3);
    roof(r, x, 0, l, d, h + 1, hall ? 34 : 29, hall);
    if (hall) {
      // A stone stair turret and a small dormer distinguish the great hall.
      stone(r, x + 9, -d * 0.12, h + 14, 13, 12, 38, variant);
      box(r, x + 7, -d * 0.12 - 2, h + 50, 17, 16, 4, [0xd4c5a1, 0xb3ae90, 0x8e967d]);
      roof(r, x + 6, -d * 0.12 + 6, 18, 16, h + 54, 13, true);
      const banner = p([x + l + 1, d * 0.18, h - 5]);
      r.moveTo(banner[0], banner[1] - 35)
        .lineTo(banner[0], banner[1])
        .stroke({ color: 0x6c6f56, width: 1.5 });
      r.poly([
        banner[0] + 1,
        banner[1] - 33,
        banner[0] + 16,
        banner[1] - 30,
        banner[0] + 13,
        banner[1] - 16,
        banner[0] + 1,
        banner[1] - 18,
      ]).fill(0x923f38);
      r.circle(banner[0] + 7, banner[1] - 25, 2.3).fill(0xd8bc77);
      for (const [xx, yy] of [
        [l / 2 + 9, 12],
        [l / 2 + 10, 25],
        [l / 2 + 18, 19],
      ])
        sack(g, xx, yy);
    } else {
      stone(r, x + l * 0.23, -d * 0.15, h + 14, 8, 9, 23, variant);
      box(r, x + l * 0.23 - 1, -d * 0.15 - 1, h + 35, 10, 11, 3, [0xc7baa0, 0xa8997e, 0x7f816b]);
      const smoke = p([x + l * 0.23 + 4, -d * 0.15 + 4, h + 42]);
      for (let i = 0; i < 5; i++)
        r.ellipse(smoke[0] + i * 3, smoke[1] - i * 9, 3 + i * 1.8, 4 + i * 2).fill({
          color: 0xe1dfc6,
          alpha: 0.07 - i * 0.008,
        });
    }
    barrel(g, x + l + 8, y + 5);
    barrel(g, x + l + 18, y + 12, 0.8);
    if (workshop) {
      // Open lean-to, workbench, timber and metal tools.
      for (const yy of [-5, 23])
        box(g, l / 2 + 25, yy, 0, 3, 3, 25, [0xa88b57, 0x8c7048, 0x66573b]);
      poly(
        r,
        [
          [l / 2, -8, 31],
          [l / 2 + 30, -8, 24],
          [l / 2 + 30, 28, 24],
          [l / 2, 28, 31],
        ],
        0x8b7450,
      );
      for (let i = 0; i < 8; i++)
        line(r, [l / 2, -7 + i * 4, 31], [l / 2 + 30, -7 + i * 4, 24], 0xc2a372, 0.8, 0.6);
      box(g, l / 2 + 7, 6, 0, 18, 10, 12, [0xab8b57, 0x85704a, 0x635a40]);
      box(g, l / 2 + 11, 8, 12, 8, 5, 5, [0x6e7b72, 0x4a5650, 0x3d4944]);
      for (let i = 0; i < 5; i++)
        box(g, -l / 2 - 12 + i * 2, d / 2 + 6, 0, 2, 22, 3, [0xb19360, 0x92774f, 0x6d6041]);
    } else {
      // Split-rail fence, vegetable patch and firewood stack.
      for (let i = 0; i < 4; i++) {
        const xx = x - 7 + i * 15;
        box(g, xx, d / 2 + 17, 0, 2, 2, 13, [0xa39161, 0x83734d, 0x686141]);
        if (i < 3) {
          line(g, [xx, d / 2 + 17, 10], [xx + 15, d / 2 + 17, 10], 0x968356, 2);
          line(g, [xx, d / 2 + 17, 5], [xx + 15, d / 2 + 17, 5], 0x87774e, 1.5);
        }
      }
      for (let i = 0; i < 5; i++) {
        const [xx, yy] = p([x - 10, 5 + i * 5, 0]);
        g.ellipse(xx, yy, 5, 2.5).fill(0x557347);
        g.ellipse(xx - 1, yy - 1, 3, 2).fill(0x819461);
      }
    }
    return { node, roof: roofs };
  }
  if (kind === 'well') {
    const xy = p([0, 0, 0]);
    g.ellipse(xy[0] + 8, 6, 26, 10).fill({ color: 0x223725, alpha: 0.2 });
    stone(g, -14, -14, 0, 28, 28, 14);
    g.ellipse(0, -13, 16, 8).fill(0x314c47);
    g.ellipse(-2, -15, 11, 4).fill(0x6f8c7b);
    for (const x of [-17, 17]) box(g, x, -2, 0, 4, 4, 47, [0xa38c59, 0x876d48, 0x675b3c]);
    line(g, [-17, 0, 33], [19, 0, 33], 0x917347, 4);
    line(g, [0, 0, 35], [0, 0, 8], 0xd3bc82, 1);
    roof(r, -23, 0, 46, 31, 49, 17);
    barrel(g, 26, 12, 0.75);
  } else if (kind === 'plaza') {
    for (const x of [-22, 18]) box(g, x, 0, 0, 3, 3, 40, [0xb1965d, 0x927548, 0x675b3c]);
    box(g, -27, -2, 20, 53, 5, 25, [0xb49864, 0x987b4d, 0x766441]);
    for (let i = 0; i < 3; i++) {
      const x = -20 + i * 13;
      poly(
        g,
        [
          [x, 3.2, 25],
          [x + 10, 3.2, 25],
          [x + 10, 3.2, 39 - i * 2],
          [x, 3.2, 39 - i * 2],
        ],
        0xeee0b8,
      );
      for (let j = 0; j < 3; j++)
        line(g, [x + 2, 3.3, 28 + j * 3], [x + 8, 3.3, 28 + j * 3], 0x8a8264, 0.7);
    }
    roof(r, -30, 0, 60, 12, 47, 7);
    box(g, 23, 8, 0, 6, 5, 10);
    box(g, 48, 8, 0, 6, 5, 10);
    box(g, 22, 7, 10, 34, 8, 3, [0xb09866, 0x877a51, 0x6c6344]);
  } else if (kind === 'gate') {
    for (const x of [-27, 20]) {
      stone(g, x, -5, 0, 12, 12, 42);
      box(r, x - 1, -6, 41, 14, 14, 3, [0xc9c5a6, 0xaab399, 0x8c9a86]);
      for (let i = 0; i < 2; i++) stone(r, x + i * 8, -5, 44, 4, 12, 6);
    }
  }
  return { node };
}

export function treeArt(seed: number) {
  const node = new Container(),
    g = new Graphics();
  node.addChild(g);
  g.ellipse(15, 7, 32, 12).fill({ color: 0x1b3426, alpha: 0.2 });
  g.ellipse(7, 4, 22, 8).fill({ color: 0x1b3022, alpha: 0.22 });
  g.poly([-5, 2, -3, -45, 1, -63, 5, -40, 6, 0, 2, 3]).fill(0x716044);
  g.moveTo(-2, 0).lineTo(0, -53).stroke({ color: 0xa38958, width: 1.2 });
  for (const [x, y] of [
    [-19, -37],
    [21, -43],
    [-9, -56],
  ])
    g.moveTo(1, -25).lineTo(x, y).stroke({ color: 0x746445, width: 3 });
  const groups = [
    [-18, -39, 19],
    [18, -43, 22],
    [0, -59, 23],
    [-10, -69, 16],
    [11, -63, 18],
  ];
  for (let i = 0; i < groups.length; i++) {
    const [x, y, r] = groups[i];
    // Irregular interlocking leaf clusters, each with its own lit edge.
    for (let j = 0; j < 18; j++) {
      const theta = random(j + seed, i) * Math.PI * 2,
        rad = Math.sqrt(random(j + 19, i + seed)) * r;
      const xx = x + Math.cos(theta) * rad,
        yy = y + Math.sin(theta) * rad * 0.75,
        size = 5 + random(i * 21, j) * 5;
      const shades = [0x506d43, 0x647c49, 0x75854e, 0x839457, 0x607846];
      g.ellipse(xx, yy, size, size * 0.8).fill(shades[Math.floor(random(j + i, seed) * 5)]);
      if (j % 3 === 0)
        g.ellipse(xx - 2, yy - 2, size * 0.6, size * 0.35).fill({ color: 0xb2bb76, alpha: 0.23 });
    }
  }
  for (let i = 0; i < 13; i++) {
    const x = (random(i, seed) - 0.5) * 37,
      y = random(i + 4, seed) * 9;
    g.ellipse(x, y, 1.7, 0.7).fill({ color: 0xc7b576, alpha: 0.4 });
  }
  return node;
}

export function wallArt(dx: number, dy: number) {
  const g = new Graphics(),
    length = 42;
  // Full half-segments meet at adjacent centers; no disconnected stone cubes.
  const end: V3 = [dx * length, dy * length, 0];
  const a: V3 = dy ? [-4, 0, 0] : [0, -4, 0],
    b: V3 = dy ? [4, 0, 0] : [0, 4, 0];
  const A: V3 = [a[0] + end[0], a[1] + end[1], 0],
    B: V3 = [b[0] + end[0], b[1] + end[1], 0];
  poly(g, [a, A, [A[0], A[1], 26], [a[0], a[1], 26]], 0x8d9a80);
  poly(g, [b, B, [B[0], B[1], 26], [b[0], b[1], 26]], 0xa3ad8d);
  poly(
    g,
    [
      [a[0], a[1], 26],
      [A[0], A[1], 26],
      [B[0], B[1], 26],
      [b[0], b[1], 26],
    ],
    0xc4c7a7,
  );
  for (let z = 5; z < 26; z += 5) {
    line(g, [b[0], b[1], z], [B[0], B[1], z], 0x687b64, 0.7, 0.5);
    for (let k = 1; k < 6; k++) {
      const t = (k + (z % 2) * 0.5) / 6;
      line(
        g,
        [b[0] + dx * length * t, b[1] + dy * length * t, z - 4],
        [b[0] + dx * length * t, b[1] + dy * length * t, z],
        0x6b7c64,
        0.7,
        0.5,
      );
    }
  }
  for (let i = 0; i < 4; i++)
    stone(g, (dx * i * length) / 4 - 3, (dy * i * length) / 4 - 3, 26, 6, 6, 6, i);
  return g;
}

export function characterArt(a: Agent) {
  const g = new Graphics(),
    female = a.sex === 'F';
  // Layered wool garment, apron/jerkin, belt, pouch and individually styled head.
  g.poly(female ? [-5, -24, 5, -24, 7, -9, -6, -9] : [-5, -24, 5, -24, 6, -12, -5, -12]).fill(
    a.color,
  );
  g.poly([-5, -23, -1, -22, -2, -11, -6, -10]).fill({ color: 0x172d24, alpha: 0.18 });
  g.moveTo(3, -23).lineTo(4, -13).stroke({ color: 0xf2e0b0, alpha: 0.22, width: 1 });
  if (female) g.poly([-2, -21, 3, -21, 4, -9, -3, -9]).fill(0xd4c29b);
  else {
    g.moveTo(-3, -22).lineTo(4, -12).stroke({ color: 0x9b7850, width: 2 });
    g.roundRect(4, -15, 4, 6, 1).fill(0x8c6b44);
  }
  g.rect(-5, -14, 10, 1.8).fill(0x665139);
  g.rect(-0.5, -14, 2.2, 2).fill(0xc3a970);
  g.roundRect(-4.2, -33, 8.5, 9, 3).fill(0xd8b88a);
  g.ellipse(3.6, -28.5, 1.5, 2).fill(0xd3ae7a);
  g.poly([-5, -30, -4, -35, 2, -36, 5, -32, 4, -30, 0, -33, -3, -30]).fill(
    a.id % 2 ? 0x67513a : 0x8a724a,
  );
  g.circle(2, -29.5, 0.65).fill(0x343c31);
  g.moveTo(2, -26.5).lineTo(3.4, -26.5).stroke({ color: 0xa57657, width: 0.6 });
  if (a.id === 2) {
    g.ellipse(0, -34.5, 6, 2).fill(0x547387);
    g.poly([-4, -35, -2, -39, 4, -37, 5, -34]).fill(0x668a9c);
  } else if (female) {
    g.poly([-5, -31, -5, -35, 0, -37, 4, -35, 5, -31, 3, -33, 0, -34, -3, -32]).fill(0xd0c6a6);
    g.moveTo(-4, -30).lineTo(-5, -24).stroke({ color: 0xc1b891, width: 2 });
  }
  return g;
}
