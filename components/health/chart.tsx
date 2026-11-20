"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

/** Two validated categorical slots (dataviz reference palette, light mode) + recessive ink. */
export const VIZ = { s1: "#2a78d6", s2: "#eb6834", ink: "#1d1d1f", muted: "#6e6e73", grid: "#e8e8ed", ref: "#a1a1a6" };

export const axisBase = {
  axisLine: { lineStyle: { color: VIZ.grid } },
  axisTick: { show: false },
  axisLabel: { color: VIZ.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: VIZ.grid } },
};

export function Chart({ option, height = 240 }: { option: echarts.EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    c.setOption({ textStyle: { fontFamily: "inherit" }, animationDuration: 500, ...option });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, [option]);
  return <div ref={ref} style={{ height }} />;
}
