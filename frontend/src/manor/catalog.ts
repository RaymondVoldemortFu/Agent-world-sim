/** Simplified manor recipes; masses in kg and durations in person-minutes. */
export const CRAFTS: Record<
  string,
  { inputs: Record<string, number>; outputs: Record<string, number>; minutes: number }
> = {
  iron_spear: { inputs: { iron: 1, wood: 1.2 }, outputs: { iron_spear: 1.8 }, minutes: 120 },
  iron_sword: { inputs: { iron: 1.6, wood: 0.2 }, outputs: { iron_sword: 1.4 }, minutes: 240 },
  wooden_shield: {
    inputs: { wood: 2.5, leather: 0.3 },
    outputs: { wooden_shield: 2.5 },
    minutes: 120,
  },
  leather_armor: {
    inputs: { leather: 3.2, cord: 0.2 },
    outputs: { leather_armor: 3 },
    minutes: 240,
  },
  iron_sickle: { inputs: { iron: 1, wood: 0.2 }, outputs: { iron_sickle: 0.85 }, minutes: 120 },
  wood_tablet: { inputs: { wood: 1.2 }, outputs: { wood_tablet: 1 }, minutes: 60 },
  iron_knife: { inputs: { iron: 0.5, wood: 0.1 }, outputs: { iron_knife: 0.5 }, minutes: 120 },
};
