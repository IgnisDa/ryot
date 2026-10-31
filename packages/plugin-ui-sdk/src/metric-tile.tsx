import clsx from "clsx";
import type { ReactNode } from "react";

import { Badge } from "./badge";
import {
	formatMetric,
	formatNumber,
	type MetricDelta,
	metricParts,
	type MetricUnit,
} from "./metric-format";
import { Card } from "./surface";

export type Metric = {
	readonly key: string;
	readonly label: string;
	readonly unit: MetricUnit;
	/** Small supporting context, such as coverage of the recorded total. */
	readonly hint?: ReactNode;
	/** The value is a known subtotal of a larger unknown total. */
	readonly atLeast?: boolean;
	readonly value: null | number;
	/** Omit when the reporting selection has no comparison period. */
	readonly delta?: undefined | MetricDelta;
};

const formatPercent = (percent: number) =>
	`${formatNumber(Math.abs(percent) >= 10 ? Math.round(Math.abs(percent)) : Math.abs(percent))}%`;

export function ChartCard(props: {
	readonly title: string;
	readonly className?: string;
	readonly actions?: ReactNode;
	readonly children: ReactNode;
	readonly description?: ReactNode;
}) {
	return (
		<Card className={clsx("flex min-w-0 flex-col gap-4", props.className)}>
			<header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-body font-semibold text-text">{props.title}</h3>
					{props.description === undefined ? null : (
						<p className="text-label text-text-muted">{props.description}</p>
					)}
				</div>
				{props.actions === undefined ? null : (
					<div className="flex min-w-0 flex-wrap items-center gap-2">{props.actions}</div>
				)}
			</header>
			{props.children}
		</Card>
	);
}

/**
 * Labelled figures with an optional change badge. `tiles` give each headline figure its own
 * surface; `panel` shares one surface in a denser grid; `plain` adds no surface.
 */
export function MetricGrid(props: {
	readonly compact: boolean;
	readonly className?: string;
	/** Trailing context for change badges, such as "vs previous period". */
	readonly comparisonLabel: string;
	readonly metrics: readonly Metric[];
	readonly variant: "tiles" | "panel" | "plain";
}) {
	const primary = props.variant === "tiles";
	const items = props.metrics.map((metric) => {
		const body = (
			<>
				<dt className="truncate text-label text-text-muted">{metric.label}</dt>
				<dd className="min-w-0">
					<MetricFigure metric={metric} primary={primary} />
				</dd>
				{metric.delta === undefined ? null : (
					<dd className="min-w-0">
						<DeltaBadge
							unit={metric.unit}
							delta={metric.delta}
							comparisonLabel={props.comparisonLabel}
						/>
					</dd>
				)}
				{metric.hint === undefined ? null : (
					<dd className="text-micro text-text-subtle">{metric.hint}</dd>
				)}
			</>
		);
		return primary ? (
			<Card key={metric.key} className="flex min-w-0 flex-col gap-1.5">
				{body}
			</Card>
		) : (
			<div key={metric.key} className="flex min-w-0 flex-col gap-1">
				{body}
			</div>
		);
	});
	const columns = props.compact ? "grid-cols-2" : "grid-cols-4";
	if (primary) {
		return <dl className={clsx("grid min-w-0 gap-3", columns, props.className)}>{items}</dl>;
	}
	const grid = (
		<dl
			className={clsx(
				"grid min-w-0 gap-x-6 gap-y-5",
				columns,
				props.variant === "plain" && props.className,
			)}
		>
			{items}
		</dl>
	);
	return props.variant === "panel" ? (
		<Card className={clsx("min-w-0", props.className)}>{grid}</Card>
	) : (
		grid
	);
}

function MetricFigure(props: { readonly metric: Metric; readonly primary: boolean }) {
	const parts = metricParts(props.metric.value, props.metric.unit);
	return (
		<span className="flex min-w-0 items-baseline gap-1">
			{props.metric.atLeast === true && parts.value !== "—" ? (
				<span className="text-label text-text-muted">≥</span>
			) : null}
			<span
				className={clsx(
					"truncate font-semibold text-text tabular-nums",
					props.primary ? "text-metric" : "text-body",
				)}
			>
				{parts.value}
			</span>
			{parts.unit === "" ? null : (
				<span className="shrink-0 text-label text-text-muted">{parts.unit}</span>
			)}
		</span>
	);
}

function DeltaBadge(props: {
	readonly unit: MetricUnit;
	readonly delta: MetricDelta;
	readonly comparisonLabel: string;
}) {
	const { delta } = props;
	if (delta.kind === "unavailable") {
		return <span className="text-micro text-text-subtle">No comparison</span>;
	}
	const signed = `${delta.absolute > 0 ? "+" : ""}${formatMetric(delta.absolute, props.unit)}`;
	let variant: "info" | "danger" | "neutral" | "success" = "neutral";
	let text = "No change";
	if (delta.kind === "new") {
		variant = "info";
		text = "New";
	} else if (Math.round(delta.percent * 10) !== 0) {
		variant = delta.percent > 0 ? "success" : "danger";
		text = `${delta.percent > 0 ? "↑" : "↓"} ${formatPercent(delta.percent)}`;
	}
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5">
			<Badge size="sm" variant={variant} className="tabular-nums">
				{text}
			</Badge>
			<span className="truncate text-micro text-text-subtle">
				{signed} {props.comparisonLabel}
			</span>
		</span>
	);
}
