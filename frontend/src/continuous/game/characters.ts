import * as T from 'three';
import { box, cylinder, ball, beam, mat, mesh, mergeRigid } from './models';
import type { Agent } from '../types';
const skin = [0xd6ac82, 0xc69b72, 0xd9b98e, 0xc99469, 0xd2aa84];
export function character(a: Agent) {
  const root = new T.Group(),
    body = new T.Group();
  root.add(body);
  root.userData.agent = a.id;
  const tone = skin[(a.id - 1) % skin.length],
    shirt = a.color,
    cloth = mat(shirt),
    dark = 0x594532;
  const hips = new T.Group();
  hips.position.y = 1.05;
  body.add(hips);
  const torso = cylinder(body, 0.34, 0.93, 0, 1.56, 0, cloth, 0.49, 10);
  torso.scale.z = 0.64;
  cylinder(body, 0.355, 0.13, 0, 1.15, 0, 0x59402c, 0.37, 10).scale.z = 0.72;
  box(body, 0.13, 0.13, 0.1, 0.08, 1.16, 0.3, 0xc7b577);
  const head = new T.Group();
  head.position.y = 2.16;
  body.add(head);
  cylinder(head, 0.13, 0.22, 0, 0.01, 0, tone, 0.14, 8);
  const face = ball(head, 0.32, 0, 0.36, 0, tone);
  face.scale.set(0.88, 1.12, 0.86);
  ball(head, 0.065, 0, 0.33, 0.29, tone).scale.z = 1.2;
  for (const sign of [-1, 1]) {
    ball(head, 0.08, sign * 0.27, 0.33, 0, tone).scale.set(0.6, 1, 0.7);
    ball(head, 0.037, sign * 0.115, 0.41, 0.262, 0x302c24);
    box(head, 0.13, 0.027, 0.036, sign * 0.11, 0.48, 0.255, 0x66503a).rotation.z = sign * 0.1;
  }
  const hair = ball(head, 0.32, 0, 0.5, -0.05, a.id % 2 ? 0x765637 : 0x4b3e2c);
  hair.scale.set(0.95, 0.7, 0.85);
  if (a.sex === 'F') {
    const hood = mesh(
      new T.SphereGeometry(0.355, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.53),
      mat(a.id === 1 ? 0xdad2b7 : 0xc9be9e),
      0,
      0.46,
      -0.04,
    );
    head.add(hood);
    ball(head, 0.16, 0, 0.25, -0.28, 0x78623c);
    const skirt = cylinder(body, 0.48, 0.75, 0, 1.03, 0, shirt, 0.34, 10);
    skirt.scale.z = 0.8;
    box(body, 0.47, 0.83, 0.065, 0, 1.09, 0.32, a.id === 3 ? 0xc0ad8a : 0xe0d1ab);
    box(body, 0.28, 0.37, 0.06, 0, 1.65, 0.36, 0xd7c9a7);
  } else {
    const hat = cylinder(
      head,
      0.38,
      0.13,
      0,
      0.72,
      -0.04,
      a.id === 2 ? 0x59727a : 0x786845,
      0.3,
      10,
    );
    hat.rotation.z = -0.08;
    cylinder(head, 0.47, 0.055, 0, 0.67, -0.04, a.id === 2 ? 0x49646d : 0x6b5d3c, 0.47, 12);
  }
  const arms: T.Group[] = [],
    forearms: T.Group[] = [],
    legs: T.Group[] = [],
    shins: T.Group[] = [];
  for (const sign of [-1, 1]) {
    const arm = new T.Group();
    arm.position.set(sign * 0.48, 1.94, 0);
    body.add(arm);
    arms.push(arm);
    cylinder(arm, 0.15, 0.5, 0, -0.22, 0, shirt, 0.19, 8);
    ball(arm, 0.18, 0, -0.02, 0, shirt);
    const fore = new T.Group();
    fore.position.y = -0.48;
    arm.add(fore);
    forearms.push(fore);
    cylinder(fore, 0.105, 0.47, 0, -0.23, 0, tone, 0.13, 8);
    ball(fore, 0.125, 0, -0.5, 0, tone).scale.set(0.8, 1.1, 0.8);
    const leg = new T.Group();
    leg.position.set(sign * 0.2, 1.04, 0);
    body.add(leg);
    legs.push(leg);
    cylinder(leg, 0.14, 0.48, 0, -0.24, 0, dark, 0.17, 8);
    const shin = new T.Group();
    shin.position.y = -0.48;
    leg.add(shin);
    shins.push(shin);
    cylinder(shin, 0.11, 0.43, 0, -0.2, 0, a.sex === 'F' ? 0x9f8b69 : 0x69624e, 0.14, 8);
    const shoe = ball(shin, 0.18, 0, -0.42, 0.09, 0x4c3928);
    shoe.scale.set(0.76, 0.5, 1.4);
  }
  const pouch = ball(body, 0.21, 0.39, 1.13, -0.08, 0x916c44);
  pouch.scale.set(0.85, 1, 0.6);
  beam(body, new T.Vector3(-0.35, 1.98, 0.27), new T.Vector3(0.36, 1.15, 0.3), 0.065, 0x765839);
  mergeRigid(body);
  const armor = new T.Group(),
    sword = new T.Group(),
    shield = new T.Group();
  cylinder(armor, 0.38, 0.87, 0, 1.59, 0, 0x7d8588, 0.5, 10).scale.z = 0.68;
  for (let row = 0; row < 5; row++)
    box(armor, 0.55, 0.025, 0.02, 0, 1.3 + row * 0.14, 0.34, 0x4c565b);
  body.add(armor);
  box(sword, 0.12, 1.35, 0.04, 0, -1.1, 0.08, 0xc6d1d1);
  box(sword, 0.4, 0.07, 0.09, 0, -0.45, 0.08, 0x78663f);
  box(sword, 0.08, 0.3, 0.08, 0, -0.3, 0.08, 0x584837);
  forearms[1].add(sword);
  const disk = cylinder(shield, 0.5, 0.12, 0, -0.4, 0.15, 0x85603f, 0.5, 12);
  disk.rotation.x = Math.PI / 2;
  ball(shield, 0.15, 0, -0.4, 0.24, 0x959da0).scale.z = 0.5;
  forearms[0].add(shield);
  const hoe = new T.Group();
  cylinder(hoe, 0.035, 1.7, 0, -0.25, 0, 0x92714d, 0.035, 6);
  box(hoe, 0.42, 0.13, 0.16, 0, -1.08, 0.09, 0x727c78);
  forearms[1].add(hoe);
  hoe.position.set(0, -0.48, 0.06);
  hoe.visible = false;
  const carried = ball(body, 0.44, 0.35, 1.4, 0.6, 0xbba57e);
  carried.scale.set(0.7, 1, 0.8);
  carried.visible = false;
  const ring = mesh(
    new T.RingGeometry(0.78, 0.91, 40),
    new T.MeshBasicMaterial({
      color: 0xf1d897,
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
    0,
    0.09,
    0,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.castShadow = false;
  ring.receiveShadow = false;
  root.add(ring);
  const shadow = mesh(
    new T.CircleGeometry(0.7, 20),
    new T.MeshBasicMaterial({
      color: 0x253822,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
    0,
    0.04,
    0,
  );
  shadow.rotation.x = -Math.PI / 2;
  root.add(shadow);
  root.traverse((o) => {
    if (o instanceof T.Mesh) o.castShadow = false;
  });
  return {
    root,
    ring,
    animate(agent: Agent, phase: number, selected: boolean) {
      ring.visible = selected;
      armor.visible = (agent.items?.mail ?? 0) >= 6;
      sword.visible = (agent.items?.iron_sword ?? 0) >= 1.4;
      shield.visible = (agent.items?.wooden_shield ?? 0) >= 2.5;
      const action = agent.action?.kind,
        walking = action === 'walk',
        working = action === 'work',
        eating = action === 'eat';
      const stride = Math.sin(phase * 7),
        swing = walking ? 0.68 : working ? 0.28 : 0.04;
      body.position.y = walking
        ? Math.abs(Math.sin(phase * 7)) * 0.06
        : Math.sin(phase * 2) * 0.014;
      body.rotation.x = agent.dead ? Math.PI / 2 : working ? 0.17 : 0;
      body.position.y = agent.dead ? 0.4 : body.position.y;
      for (let i = 0; i < 2; i++) {
        const sign = i ? 1 : -1;
        legs[i].rotation.x = walking ? stride * sign * 0.55 : 0;
        shins[i].rotation.x = walking ? Math.max(0, -stride * sign) * 0.5 : 0;
        arms[i].rotation.x = walking
          ? -stride * sign * swing
          : working
            ? -1.1 + Math.sin(phase * 4) * 0.5
            : -0.08;
        arms[i].rotation.z = sign * (working ? 0.1 : 0.08);
        forearms[i].rotation.x = working ? -0.4 : walking ? -0.25 : -0.12;
      }
      if (eating) {
        arms[1].rotation.x = -1.2;
        forearms[1].rotation.x = -1 + Math.sin(phase * 4) * 0.1;
      }
      if (agent.voice && !walking) {
        arms[0].rotation.x = -0.65 + Math.sin(phase * 3) * 0.15;
        forearms[0].rotation.x = -0.55;
      }
      carried.visible = action === 'withdraw' || action === 'deposit';
      if (carried.visible) {
        arms[0].rotation.x = arms[1].rotation.x = -0.9;
        forearms[0].rotation.x = forearms[1].rotation.x = -0.6;
      }
      hoe.visible = working;
      head.rotation.x = working ? 0.15 : eating ? 0.08 : Math.sin(phase * 0.6) * 0.03;
      if (agent.dead) {
        ring.visible = false;
        hoe.visible = false;
        carried.visible = false;
      }
    },
  };
}
