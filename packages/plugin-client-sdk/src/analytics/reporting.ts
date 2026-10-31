import { addCalendarDays, localDateOf } from "@ryot-app/contract/modules/analytics/calendar";
import {
	REPORTING_BUCKET_LIMIT,
	type ReportingRange,
	reportingRangePresets,
	reportingRangeValue,
	type ReportingSelection,
	resolveReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import type { TimeZone } from "@ryot-app/contract/schema/time-zone";

type CaptionPeriod = null | { readonly endDate: string; readonly startDate: string };

export const periodCaption = (period: CaptionPeriod) => {
	if (period === null) {
		return "All time";
	}
	return period.startDate === period.endDate
		? period.startDate
		: `${period.startDate} – ${period.endDate}`;
};

export const formatExactValue = (value: null | number, unit: null | string = null) => {
	if (value === null || !Number.isFinite(value)) {
		return "Unknown";
	}
	return `${Object.is(value, -0) ? "0" : String(value)}${unit === null || unit === "" ? "" : ` ${unit}`}`;
};

const compareValues = (current: null | number, previous: null | number) => {
	if (
		current === null ||
		previous === null ||
		!Number.isFinite(current) ||
		!Number.isFinite(previous)
	) {
		return { percent: null, absolute: null, kind: "unknown" as const };
	}
	const absolute = current - previous;
	let percent: null | number = null;
	if (previous !== 0) {
		percent = (absolute / Math.abs(previous)) * 100;
	} else if (current === 0) {
		percent = 0;
	}
	return {
		percent,
		absolute,
		kind: previous === 0 && current > 0 ? ("new-activity" as const) : ("change" as const),
	};
};

export const comparisonDetail = (input: {
	readonly unit: string;
	readonly current: null | number;
	readonly previous: null | number;
	readonly resolved: { readonly current: CaptionPeriod; readonly previous: CaptionPeriod };
}) => {
	const currentCaption = periodCaption(input.resolved.current);
	if (input.resolved.previous === null) {
		return `${currentCaption} · No comparison`;
	}
	const periods = `${currentCaption} vs ${periodCaption(input.resolved.previous)}`;
	const comparison = compareValues(input.current, input.previous);
	if (comparison.kind === "unknown") {
		return `${periods} · Change unavailable`;
	}
	if (comparison.kind === "new-activity") {
		return `${periods} · New activity · +${formatExactValue(comparison.absolute, input.unit)}`;
	}
	const delta = `${comparison.absolute > 0 ? "+" : ""}${formatExactValue(comparison.absolute, input.unit)}`;
	const percent =
		comparison.percent === null ? "" : ` (${formatExactValue(comparison.percent, "%")})`;
	return `${periods} · ${delta}${percent}`;
};

/** A daily selection of at most `REPORTING_BUCKET_LIMIT` days ending at the period end or today. */
export const consistencySelection = (
	input: { readonly timeZone: TimeZone; readonly selection: ReportingSelection },
	now: number,
) => {
	const current = resolveReportingSelection(input.selection, {
		now,
		timeZone: input.timeZone,
	}).current;
	const endDate = current?.endDate ?? localDateOf(now, input.timeZone);
	const earliest = addCalendarDays(endDate, 1 - REPORTING_BUCKET_LIMIT);
	const startDate = current === null || current.startDate < earliest ? earliest : current.startDate;
	return {
		clipped: current === null || current.startDate < startDate,
		selection: {
			grouping: "day",
			comparison: "none",
			range: { endDate, startDate, kind: "custom" },
		} satisfies ReportingSelection,
	};
};

const rangeLabel = (range: (typeof reportingRangePresets)[number]) =>
	range.kind === "rolling"
		? `Last ${range.days} days`
		: `${range.offset === 0 ? "This" : "Previous"} ${range.unit}`;

export const reportingRangeOptions: ReadonlyArray<{
	readonly value: string;
	readonly label: string;
	readonly range: null | ReportingRange;
}> = [
	...reportingRangePresets.map((range) => ({
		range,
		label: rangeLabel(range),
		value: reportingRangeValue(range),
	})),
	{ range: null, value: "custom", label: "Custom dates" },
	{ value: "all-time", label: "All time", range: { kind: "all-time" } },
];
