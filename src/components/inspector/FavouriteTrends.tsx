"use client";

import { memo, useEffect, useRef, useState } from "react";
import { formatCompact } from "@/lib/model";
import type { ResourceAmount, ResourceBalance } from "@/lib/model/types";
import { selectTrendSeries, useResourceTrends } from "@/lib/resource-trends";
import { toggleResourceFavourite } from "@/lib/workspace-view";
import { ResourceIcon } from "../nei/ResourceIcon";
import { TrendSparkline } from "./TrendSparkline";

type TrendResourceDisplay = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

const CHART_HEIGHT = 34;

/**
 * The starred resources, each with its own chart of recent edits.
 *
 * Lives at the foot of the resource panel rather than inline in the list
 * because a chart needs the full column width to be worth drawing, and because
 * the point of starring something is to keep watching it while you scroll the
 * list above to somewhere else entirely.
 */
export function FavouriteTrends({
  favourites,
  resourcesByKey,
  open,
  onToggleOpen,
}: {
  favourites: ResourceBalance[];
  resourcesByKey: Map<string, TrendResourceDisplay>;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const history = useResourceTrends();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(220);

  // The charts are SVG at explicit pixel widths, so they need the real column
  // width rather than a percentage - and it changes when the side panels open
  // and close.
  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => setChartWidth(Math.max(80, element.clientWidth - 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  return (
    <section className="flex shrink-0 flex-col border-t border-line bg-surface-sunken/40">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="flex h-7 shrink-0 items-center gap-2 px-2 text-left hover:bg-surface-sunken"
      >
        <span className={["text-[11px] leading-none", open ? "rotate-90" : ""].join(" ")}>▶</span>
        <span className="text-xs font-bold uppercase tracking-wider text-amber-200">Watching</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-100">
          {favourites.length}
        </span>
        <span className="ml-auto truncate text-[11px] text-fg-muted">
          {/* Naming the axis matters: every other chart in every other tool is
              against time, and this one is not. */}
          net per edit
        </span>
      </button>

      {open ? (
        <div
          ref={bodyRef}
          className="max-h-[42vh] min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
        >
          {favourites.map((balance) => (
            <FavouriteTrendRow
              key={balance.key}
              balance={balance}
              resource={resourcesByKey.get(balance.key)}
              series={selectTrendSeries(history, balance.key)}
              width={chartWidth}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

const FavouriteTrendRow = memo(function FavouriteTrendRow({
  balance,
  resource,
  series,
  width,
}: {
  balance: ResourceBalance;
  resource?: TrendResourceDisplay;
  series: number[];
  width: number;
}) {
  const unit = balance.kind === "fluid" ? "L/s" : "/s";
  const net = balance.netPerSecond;
  const first = series[0];
  const latest = series[series.length - 1];
  // Change since the chart starts, which is the question the chart exists to
  // answer. Only meaningful once there are two points to compare.
  const delta = series.length >= 2 && first !== undefined && latest !== undefined
    ? latest - first
    : undefined;

  return (
    <div className="mt-2 rounded border border-line bg-surface-raised px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden">
          <ResourceIcon
            resource={{
              kind: balance.kind,
              id: balance.resourceId,
              amount: 1,
              displayName: balance.displayName,
              iconPath: resource?.iconPath,
              iconAtlas: resource?.iconAtlas,
              dominantColor: resource?.dominantColor,
            }}
            size="sm"
            showAmount={false}
            bare
            tooltip={false}
            className="!h-full !w-full"
          />
        </span>
        <span className="truncate text-xs font-medium text-fg">
          {balance.displayName ?? balance.resourceId}
        </span>
        <button
          type="button"
          onClick={() => toggleResourceFavourite(balance.key)}
          title="Stop watching this resource"
          aria-label={`Stop watching ${balance.displayName ?? balance.resourceId}`}
          className="ml-auto shrink-0 rounded px-1 text-[11px] leading-none text-amber-300 hover:bg-amber-500/20"
        >
          ★
        </button>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={[
            "text-sm font-bold tabular-nums",
            net > 0.000001
              ? "text-emerald-300"
              : net < -0.000001
                ? "text-red-300"
                : "text-fg-subtle",
          ].join(" ")}
        >
          {net > 0 ? "+" : net < 0 ? "−" : ""}
          {formatCompact(Math.abs(net))}
          <span className="ml-0.5 text-[10px] font-semibold opacity-70">{unit}</span>
        </span>
        {delta !== undefined && Math.abs(delta) > 0.000001 ? (
          <span
            className={[
              "text-[11px] font-semibold tabular-nums",
              delta > 0 ? "text-emerald-400/80" : "text-red-400/80",
            ].join(" ")}
            title="Change since the start of the chart"
          >
            {delta > 0 ? "▲" : "▼"} {formatCompact(Math.abs(delta))}
          </span>
        ) : null}
      </div>

      <div className="mt-1">
        <TrendSparkline series={series} width={width} height={CHART_HEIGHT} unit={unit} />
      </div>
    </div>
  );
});
