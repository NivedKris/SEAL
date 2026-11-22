/** Chart colours and axis style, kept apart from the chart library so pages can use them without loading it. */
/** Two validated categorical slots (dataviz reference palette, light mode) + recessive ink. */
export const VIZ = { s1: "#2a78d6", s2: "#eb6834", ink: "#1d1d1f", muted: "#6e6e73", grid: "#e8e8ed", ref: "#a1a1a6" };

export const axisBase = {
  axisLine: { lineStyle: { color: VIZ.grid } },
  axisTick: { show: false },
  axisLabel: { color: VIZ.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: VIZ.grid } },
};
