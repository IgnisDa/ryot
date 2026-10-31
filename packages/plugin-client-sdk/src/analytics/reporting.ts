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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dateParts = (date: string) => {
	const [year = "", month = "", day = ""] = date.split("-");
	return { year, day: String(Number(day)), month: MONTHS[Number(month) - 1] ?? month };
};

export const periodCaption = (period: CaptionPeriod) => {
	if (period === null) {
		return "All time";
	}
	const start = dateParts(period.startDate);
	const end = dateParts(period.endDate);
	if (period.startDate === period.endDate) {
		return `${start.month} ${start.day}, ${start.year}`;
	}
	if (start.year !== end.year) {
		return `${start.month} ${start.day}, ${start.year} – ${end.month} ${end.day}, ${end.year}`;
	}
	return start.month === end.month
		? `${start.month} ${start.day} – ${end.day}, ${end.year}`
		: `${start.month} ${start.day} – ${end.month} ${end.day}, ${end.year}`;
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
