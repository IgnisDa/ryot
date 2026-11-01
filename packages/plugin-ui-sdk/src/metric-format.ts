/** Reporting text uses one explicit locale so figures never depend on the host environment. */
export const REPORTING_LOCALE = "en-US";

export type MetricUnit =
	| { readonly kind: "percent" }
	| { readonly symbol: string; readonly kind: "measure" }
	| { readonly kind: "duration"; readonly from: "seconds" | "minutes" }
	| { readonly one: string; readonly kind: "count"; readonly other: string };

export const percentUnit: MetricUnit = { kind: "percent" };

export const countUnit = (one: string, other = `${one}s`): MetricUnit => ({
	one,
	other,
	kind: "count",
});

export const durationUnit = (from: "seconds" | "minutes"): MetricUnit => ({
	from,
	kind: "duration",
});

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

const numberFormats = new Map<string, Intl.NumberFormat>();

const numberFormat = (options: Intl.NumberFormatOptions) => {
	const key = JSON.stringify(options);
	let format = numberFormats.get(key);
	if (format === undefined) {
		format = new Intl.NumberFormat(REPORTING_LOCALE, options);
		numberFormats.set(key, format);
	}
	return format;
};

const fractionDigits = (value: number) => {
	const magnitude = Math.abs(value);
	if (magnitude >= 100) {
		return 0;
	}
	return magnitude >= 10 ? 1 : 2;
};

export const formatNumber = (value: number) =>
	numberFormat({ maximumFractionDigits: fractionDigits(value) }).format(
		Object.is(value, -0) ? 0 : value,
	);

const formatCompactNumber = (value: number) =>
	numberFormat({ notation: "compact", maximumFractionDigits: 1 }).format(value);

const durationSeconds = (value: number, from: "seconds" | "minutes") =>
	Math.round(from === "minutes" ? value * 60 : value);

const formatDuration = (seconds: number) => {
	const sign = seconds < 0 ? "-" : "";
	const total = Math.abs(Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const rest = total % 60;
	if (hours >= 100) {
		return `${sign}${formatNumber(Math.round(total / 3600))}h`;
	}
	if (hours > 0) {
		return `${sign}${hours}h${minutes === 0 ? "" : ` ${minutes}m`}`;
	}
	if (minutes > 0) {
		return `${sign}${minutes}m${rest === 0 ? "" : ` ${rest}s`}`;
	}
	return `${sign}${rest}s`;
};

export type MetricParts = { readonly unit: string; readonly value: string };

export const metricParts = (value: null | number, unit: MetricUnit): MetricParts => {
	if (value === null || !Number.isFinite(value)) {
		return { unit: "", value: "—" };
	}
	if (unit.kind === "duration") {
		return { unit: "", value: formatDuration(durationSeconds(value, unit.from)) };
	}
	if (unit.kind === "percent") {
		return { unit: "%", value: formatNumber(value) };
	}
	if (unit.kind === "measure") {
		return { unit: unit.symbol, value: formatNumber(value) };
	}
	return { value: formatNumber(value), unit: value === 1 ? unit.one : unit.other };
};

export const formatMetric = (value: null | number, unit: MetricUnit) => {
	if (value === null || !Number.isFinite(value)) {
		return "Unknown";
	}
	const parts = metricParts(value, unit);
	if (parts.unit === "") {
		return parts.value;
	}
	return unit.kind === "percent" ? `${parts.value}%` : `${parts.value} ${parts.unit}`;
};

export const formatAxisValue = (value: number, unit: MetricUnit) => {
	if (unit.kind === "duration") {
		const seconds = durationSeconds(value, unit.from);
		if (Math.abs(seconds) >= 3600) {
			return `${formatCompactNumber(seconds / 3600)}h`;
		}
		return Math.abs(seconds) >= 60 ? `${formatCompactNumber(seconds / 60)}m` : `${seconds}s`;
	}
	return unit.kind === "percent" ? `${formatCompactNumber(value)}%` : formatCompactNumber(value);
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
