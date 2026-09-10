/** Preferences affect discretionary behavior; physical safety and consent stay in the engine. */
export function preferences(values: number[] = []) {
  const [openness, diligence, extraversion, agreeableness, sensitivity] = Array.from(
    { length: 5 },
    (_, i) => Math.max(0, Math.min(1, values[i] ?? 0.5)),
  );
  return {
    openness,
    diligence,
    extraversion,
    agreeableness,
    sensitivity,
    reserveKcal: 1700 + 1800 * diligence + 1200 * sensitivity,
    foodRisk: 0.38 + 0.12 * openness - 0.12 * sensitivity,
    socialDays: extraversion < 0.4 ? 3 : extraversion < 0.7 ? 2 : 1,
    reconsiderDays: Math.round(2 + 5 * diligence),
  };
}
