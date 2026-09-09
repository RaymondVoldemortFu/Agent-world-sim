import type { Inventory, Item } from './types';
export const RECIPES = [
  {
    id: 'basic_tool',
    materials: { wood: 2 } as Inventory,
    method: 'combine',
    product: 'basic_tool' as Item,
    tool: undefined as Item | undefined,
  },
  {
    id: 'advanced_tool',
    materials: { wood: 2, stone: 2 } as Inventory,
    method: 'grind',
    product: 'advanced_tool' as Item,
    tool: 'basic_tool' as Item | undefined,
  },
  {
    id: 'shelter',
    materials: { wood: 6, stone: 2 } as Inventory,
    method: 'assemble',
    product: undefined,
    tool: undefined as Item | undefined,
  },
];
