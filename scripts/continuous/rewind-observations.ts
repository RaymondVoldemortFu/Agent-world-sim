/** Offline observation reconstruction; does not start a server or advance simulation time. */
import fs from 'node:fs';
import { observation } from './observation';
import type { World, Event } from '../../frontend/src/continuous/types';
const { world, events }: { world: World; events: Event[] } = JSON.parse(
  fs.readFileSync(process.argv[2], 'utf8'),
);
const outputs = world.agents.map((a) => observation(world, a.id, events, 0));
fs.writeFileSync(process.argv[3], JSON.stringify(outputs));
