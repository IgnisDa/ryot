import {
	type RatingScale,
	ratingScales,
	threePointRatings,
	toScale,
} from "@ryot-app/contract/modules/events/rating-scale";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useMemo } from "react";

export type MetricUnit =
	| { readonly kind: "percent" }
	| { readonly symbol: string; readonly kind: "measure" }
	| { readonly kind: "rating"; readonly scale: RatingScale }
	| { readonly kind: "duration"; readonly from: "seconds" | "minutes" }
	| { readonly kind: "count"; readonly label: (count: number) => string };

export const percentUnit: MetricUnit = { kind: "percent" };

/** `label` names the counted thing for a count, such as a plural-aware catalog message. */
export const countUnit = (label: (count: number) => string): MetricUnit => ({
	label,
	kind: "count",
});

export const durationUnit = (from: "seconds" | "minutes"): MetricUnit => ({
	from,
	kind: "duration",
});

const ratingUnits = new Map<RatingScale, MetricUnit>();

/** Stored 0–100 ratings shown in the user's scale; cached per scale like `measureUnit`. */
export const ratingUnit = (scale: RatingScale): MetricUnit => {
	let unit = ratingUnits.get(scale);
	if (unit === undefined) {
		unit = { scale, kind: "rating" };
		ratingUnits.set(scale, unit);
	}
	return unit;
};

const measureUnits = new Map<string, MetricUnit>();

/** Cached per symbol so units derived from data stay referentially stable for chart definitions. */
export const measureUnit = (symbol: string): MetricUnit => {
	let unit = measureUnits.get(symbol);
	if (unit === undefined) {
		unit = { symbol, kind: "measure" };
		measureUnits.set(symbol, unit);
	}
	return unit;
};

const fractionDigits = (value: number) => {
	const magnitude = Math.abs(value);
	if (magnitude >= 100) {
		return 0;
	}
	return magnitude >= 10 ? 1 : 2;
};

const durationSeconds = (value: number, from: "seconds" | "minutes") =>
	Math.round(from === "minutes" ? value * 60 : value);

type DurationPart = readonly [value: number, unit: "hour" | "minute" | "second"];

/** The two largest non-zero units, such as `1h 5m`; whole hours only from 100 hours on. */
export const formatDuration = (
	formatters: Formatters,
	seconds: number,
	smallestUnit: "minute" | "second" = "second",
) => {
	const step = smallestUnit === "minute" ? 60 : 1;
	const total = Math.round(Math.abs(seconds) / step) * step;
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	let parts: readonly DurationPart[] = [[total, "second"]];
	if (hours >= 100) {
		parts = [[Math.round(total / 3600), "hour"]];
	} else if (hours > 0) {
		parts = [
			[hours, "hour"],
			[minutes, "minute"],
		];
	} else if (total >= 60 || step === 60) {
		parts = [
			[minutes, "minute"],
			[total % 60, "second"],
		];
	}
	const sign = seconds < 0 && total > 0 ? -1 : 1;
	return formatters
		.list({ type: "unit", style: "narrow" })
		.format(
			parts
				.filter(([value], index) => index === 0 || value > 0)
				.map(([value, unit], index) =>
					formatters
						.number({ unit, style: "unit", unitDisplay: "narrow" })
						.format(index === 0 ? sign * value : value),
				),
		);
};

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** Elapsed whole seconds as `m:ss`, or `h:mm:ss` from an hour on. */
export const formatClock = (seconds: number) => {
	const whole = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(whole / 60);
	return minutes < 60
		? `${minutes}:${twoDigits(whole % 60)}`
		: `${Math.floor(minutes / 60)}:${twoDigits(minutes % 60)}:${twoDigits(whole % 60)}`;
};

export type MetricParts = { readonly unit: string; readonly value: string };

export type MetricFormat = {
	readonly formatNumber: (value: number) => Text;
	readonly formatRating: (rating: number, scale: RatingScale) => Text;
	readonly formatAxisValue: (value: number, unit: MetricUnit) => Text;
	readonly formatMetric: (value: null | number, unit: MetricUnit) => Text;
	readonly metricParts: (value: null | number, unit: MetricUnit) => MetricParts;
};

/** Figures, units, ratings and durations in the viewer's locale. */
export const metricFormat = (
	t: (message: Message) => Text,
	formatters: Formatters,
): MetricFormat => {
	const formatNumber = (value: number) =>
		Text(
			formatters
				.number({ maximumFractionDigits: fractionDigits(value) })
				.format(Object.is(value, -0) ? 0 : value),
		);
	const formatCompactNumber = (value: number) =>
		formatters.number({ notation: "compact", maximumFractionDigits: 1 }).format(value);
	const percent = (value: number) =>
		formatters
			.number({ style: "percent", maximumFractionDigits: fractionDigits(value) })
			.formatToParts(value / 100);
	const formatRating = (rating: number, scale: RatingScale) => {
		const scaled = toScale(rating, scale);
		if (scale === "three-point") {
			return t(
				kernelMessage("ui.rating.three-point", { rating: threePointRatings[scaled] ?? "neutral" }),
			);
		}
		const digits =
			scale === "hundred" ? { maximumFractionDigits: 1 } : { minimumFractionDigits: 1 };
		return Text(formatters.number({ maximumFractionDigits: 1, ...digits }).format(scaled));
	};
	const metricParts = (value: null | number, unit: MetricUnit): MetricParts => {
		if (value === null || !Number.isFinite(value)) {
			return { unit: "", value: "—" };
		}
		if (unit.kind === "count") {
			return { unit: unit.label(value), value: formatNumber(value) };
		}
		if (unit.kind === "measure") {
			return { unit: unit.symbol, value: formatNumber(value) };
		}
		if (unit.kind === "rating") {
			return {
				value: formatRating(value, unit.scale),
				unit:
					unit.scale === "three-point"
						? ""
						: t(kernelMessage("ui.metric.rating-unit", { max: ratingScales[unit.scale].max })),
			};
		}
		if (unit.kind === "percent") {
			const parts = percent(value);
			return {
				unit: parts
					.filter((part) => part.type === "percentSign")
					.map((part) => part.value)
					.join(""),
				value: parts
					.filter((part) => part.type !== "percentSign" && part.type !== "literal")
					.map((part) => part.value)
					.join(""),
			};
		}
		return { unit: "", value: formatDuration(formatters, durationSeconds(value, unit.from)) };
	};
	const formatMetric = (value: null | number, unit: MetricUnit) => {
		if (value === null || !Number.isFinite(value)) {
			return t(kernelMessage("ui.metric.unknown"));
		}
		if (unit.kind === "percent") {
			return Text(
				percent(value)
					.map((part) => part.value)
					.join(""),
			);
		}
		const parts = metricParts(value, unit);
		return parts.unit === ""
			? Text(parts.value)
			: t(kernelMessage("ui.metric.value-with-unit", { unit: parts.unit, value: parts.value }));
	};
	const formatAxisValue = (value: number, unit: MetricUnit) => {
		if (unit.kind === "percent") {
			return Text(
				formatters
					.number({ style: "percent", notation: "compact", maximumFractionDigits: 1 })
					.format(value / 100),
			);
		}
		if (unit.kind !== "duration") {
			return Text(formatCompactNumber(value));
		}
		const seconds = durationSeconds(value, unit.from);
		if (Math.abs(seconds) >= 3600) {
			return t(
				kernelMessage("ui.metric.axis-duration", {
					unit: "hours",
					value: formatCompactNumber(seconds / 3600),
				}),
			);
		}
		return Math.abs(seconds) >= 60
			? t(
					kernelMessage("ui.metric.axis-duration", {
						unit: "minutes",
						value: formatCompactNumber(seconds / 60),
					}),
				)
			: t(
					kernelMessage("ui.metric.axis-duration", {
						unit: "seconds",
						value: formatCompactNumber(seconds),
					}),
				);
	};
	return { metricParts, formatNumber, formatRating, formatMetric, formatAxisValue };
};

export const useMetricFormat = () => {
	const t = useT();
	const formatters = useFormatters();
	return useMemo(() => metricFormat(t, formatters), [t, formatters]);
};

const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;

/** Evenly spaced ticks from zero (or the minimum) that cover `max`; counts never get fractional steps. */
export const axisTicks = (
	min: number,
	max: number,
	unit: MetricUnit,
	count: number,
): ReadonlyArray<number> => {
	const low = Math.min(0, min);
	const high = Math.max(low + 1, max);
	const raw = (high - low) / Math.max(1, count);
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const nice = (NICE_STEPS.find((step) => step * magnitude >= raw) ?? 10) * magnitude;
	const step = unit.kind === "count" ? Math.max(1, Math.ceil(nice)) : nice;
	const first = Math.floor(low / step) * step;
	const ticks: number[] = [];
	for (let tick = first; tick < high + step; tick += step) {
		ticks.push(Number(tick.toPrecision(12)));
		if (tick >= high) {
			break;
		}
	}
	return ticks;
};

export type MetricDelta =
	| { readonly kind: "unavailable" }
	| { readonly kind: "new"; readonly absolute: number }
	| { readonly kind: "change"; readonly percent: number; readonly absolute: number };

export const metricDelta = (current: null | number, previous: null | number): MetricDelta => {
	if (
		current === null ||
		previous === null ||
		!Number.isFinite(current) ||
		!Number.isFinite(previous)
	) {
		return { kind: "unavailable" };
	}
	const absolute = current - previous;
	if (previous === 0) {
		return current === 0 ? { absolute, percent: 0, kind: "change" } : { absolute, kind: "new" };
	}
	return { absolute, kind: "change", percent: (absolute / Math.abs(previous)) * 100 };
};
