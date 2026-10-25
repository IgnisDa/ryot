import { DateTime, Result, Schema } from "effect";

import { TimeZone } from "../../schema/time-zone";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import {
	addCalendarDays,
	addCalendarUnits,
	calendarDaysBetween,
	type CalendarUnit,
	localDateOf,
	startOfCalendarUnit,
} from "./calendar";

export const ReportingPreferences = strictStruct({ timeZone: TimeZone });
export type ReportingPreferences = typeof ReportingPreferences.Type;

export const CalendarDate = Schema.String.check(
	Schema.makeFilter((value) => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return false;
		}
		const date = new Date(`${value}T00:00:00.000Z`);
		return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
	}),
);

export const ReportingGrouping = Schema.Literals(["auto", "day", "week", "month", "year"]);
export type ReportingGrouping = typeof ReportingGrouping.Type;
export const ReportingRange = Schema.Union([
	strictStruct({ kind: Schema.Literal("all-time") }),
	strictStruct({ kind: Schema.Literal("rolling"), days: Schema.Literals([7, 30, 90, 365]) }),
	strictStruct({
		kind: Schema.Literal("calendar"),
		offset: Schema.Literals([0, -1]),
		unit: Schema.Literals(["week", "month", "year"]),
	}),
	strictStruct({
		endDate: CalendarDate,
		startDate: CalendarDate,
		kind: Schema.Literal("custom"),
	}).check(Schema.makeFilter((value) => value.startDate <= value.endDate)),
]);
export type ReportingRange = typeof ReportingRange.Type;

export const ReportingSelection = strictStruct({
	range: ReportingRange,
	grouping: ReportingGrouping,
	comparison: Schema.Literals(["none", "previous-period"]),
});
export type ReportingSelection = typeof ReportingSelection.Type;

export const defaultReportingSelection: ReportingSelection = {
	grouping: "auto",
	comparison: "previous-period",
	range: { days: 30, kind: "rolling" },
};

export const ReportingPeriod = strictStruct({
	endAt: IsoUtcString,
	endDate: CalendarDate,
	startAt: IsoUtcString,
	startDate: CalendarDate,
});
export type ReportingPeriod = typeof ReportingPeriod.Type;

export const REPORTING_BUCKET_LIMIT = 366;

const groupingOrder = ["day", "week", "month", "year"] as const satisfies readonly CalendarUnit[];

const automaticGrouping = (days: number): CalendarUnit => {
	if (days <= 90) {
		return "day";
	}
	if (days <= 730) {
		return "week";
	}
	return days <= 3653 ? "month" : "year";
};

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

const bucketCount = (startDate: string, endDate: string, unit: CalendarUnit) => {
	if (unit === "year") {
		return Number(endDate.slice(0, 4)) - Number(startDate.slice(0, 4)) + 1;
	}
	if (unit === "month") {
		return monthIndex(endDate) - monthIndex(startDate) + 1;
	}
	const days = calendarDaysBetween(startOfCalendarUnit(startDate, unit), endDate) + 1;
	return unit === "week" ? Math.ceil(days / 7) : days;
};

const boundedGrouping = (requested: CalendarUnit, startDate: string, endDate: string) =>
	groupingOrder
		.slice(groupingOrder.indexOf(requested))
		.find((unit) => bucketCount(startDate, endDate, unit) <= REPORTING_BUCKET_LIMIT) ?? "year";

const calendarStep = { week: { weeks: 1 }, year: { years: 1 }, month: { months: 1 } };

const periodBetween = (
	start: DateTime.Utc,
	end: DateTime.Utc,
	timeZone: TimeZone,
): ReportingPeriod => ({
	startDate: DateTime.formatIsoDate(start),
	endDate: DateTime.formatIsoDate(DateTime.subtract(end, { days: 1 })),
	endAt: DateTime.formatIso(DateTime.makeZonedUnsafe(end, { timeZone, adjustForTimeZone: true })),
	startAt: DateTime.formatIso(
		DateTime.makeZonedUnsafe(start, { timeZone, adjustForTimeZone: true }),
	),
});

export const calendarPeriod = (startDate: string, endDate: string, timeZone: TimeZone) =>
	periodBetween(
		DateTime.makeUnsafe(startDate),
		DateTime.add(DateTime.makeUnsafe(endDate), { days: 1 }),
		timeZone,
	);

const calendarDays = (start: DateTime.Utc, end: DateTime.Utc) =>
	calendarDaysBetween(DateTime.formatIsoDate(start), DateTime.formatIsoDate(end));

/** All-time reports group by year; bounded ranges coarsen until they fit `REPORTING_BUCKET_LIMIT`. */
export const resolveReportingSelection = (
	selection: ReportingSelection,
	input: { readonly now: number; readonly timeZone: TimeZone },
) => {
	const timeZone = input.timeZone;
	const today = DateTime.makeUnsafe(
		DateTime.formatIsoDate(DateTime.makeZonedUnsafe(input.now, { timeZone })),
	);
	const range = selection.range;
	if (range.kind === "all-time") {
		return { timeZone, current: null, previous: null, grouping: "year" as CalendarUnit };
	}
	let start: DateTime.Utc;
	let end: DateTime.Utc;
	let previousStart: DateTime.Utc;
	if (range.kind === "calendar") {
		const anchor = DateTime.startOf(today, range.unit, { weekStartsOn: 1 });
		const parts = calendarStep[range.unit];
		start = range.offset === -1 ? DateTime.subtract(anchor, parts) : anchor;
		end = DateTime.add(start, parts);
		previousStart = DateTime.subtract(start, parts);
	} else {
		end =
			range.kind === "rolling"
				? DateTime.add(today, { days: 1 })
				: DateTime.add(DateTime.makeUnsafe(range.endDate), { days: 1 });
		start =
			range.kind === "rolling"
				? DateTime.subtract(end, { days: range.days })
				: DateTime.makeUnsafe(range.startDate);
		previousStart = DateTime.subtract(start, { days: calendarDays(start, end) });
	}
	const current = periodBetween(start, end, timeZone);
	return {
		current,
		timeZone,
		previous:
			selection.comparison === "previous-period"
				? periodBetween(previousStart, start, timeZone)
				: null,
		grouping: boundedGrouping(
			selection.grouping === "auto"
				? automaticGrouping(calendarDays(start, end))
				: selection.grouping,
			current.startDate,
			current.endDate,
		),
	};
};

export type ResolvedReportingSelection = ReturnType<typeof resolveReportingSelection>;

export const selectionForPeriod = (
	selection: ReportingSelection,
	period: null | ReportingPeriod,
): ReportingSelection => ({
	comparison: "none",
	grouping: selection.grouping,
	range:
		period === null
			? { kind: "all-time" }
			: { kind: "custom", endDate: period.endDate, startDate: period.startDate },
});

export type Reported<Data> = Data & { readonly reporting: ReportingExecution };

/** `selection` pins the resolved current period so later pages and drills ignore clock movement. */
export type ReportingExecution = {
	readonly now: number;
	readonly selection: ReportingSelection;
	readonly resolved: ResolvedReportingSelection;
};

export const reportingExecution = (
	selection: ReportingSelection,
	input: { readonly now: number; readonly timeZone: TimeZone },
): ReportingExecution => {
	const resolved = resolveReportingSelection(selection, input);
	return {
		resolved,
		now: input.now,
		selection: selectionForPeriod({ ...selection, grouping: resolved.grouping }, resolved.current),
	};
};

export const periodCaption = (
	period: null | { readonly endDate: string; readonly startDate: string },
) => {
	if (period === null) {
		return "All time";
	}
	return period.startDate === period.endDate
		? period.startDate
		: `${period.startDate} – ${period.endDate}`;
};

export const comparisonCaption = (
	resolved: Pick<ResolvedReportingSelection, "current" | "previous">,
) =>
	resolved.previous === null
		? null
		: `${periodCaption(resolved.current)} vs ${periodCaption(resolved.previous)}`;

export const formatExactValue = (value: null | number, unit: null | string = null) => {
	if (value === null || !Number.isFinite(value)) {
		return "Unknown";
	}
	return `${Object.is(value, -0) ? "0" : String(value)}${unit === null || unit === "" ? "" : ` ${unit}`}`;
};

export const compareValues = (current: null | number, previous: null | number) => {
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

export type CalendarBucket<Point> = {
	/** First local date of the grouping unit, which may precede `period.startDate`. */
	readonly date: string;
	readonly period: ReportingPeriod;
	readonly points: ReadonlyArray<Point>;
};

/** Every bucket of `period`, or of the points' extent when `period` is null, with points by local date. */
export const calendarBuckets = <Point>(
	points: ReadonlyArray<Point>,
	input: {
		readonly timeZone: TimeZone;
		readonly grouping: CalendarUnit;
		readonly at: (point: Point) => string;
		readonly period: null | ReportingPeriod;
	},
): ReadonlyArray<CalendarBucket<Point>> => {
	const grouped = new Map<string, Point[]>();
	for (const point of points) {
		const date = startOfCalendarUnit(localDateOf(input.at(point), input.timeZone), input.grouping);
		grouped.set(date, [...(grouped.get(date) ?? []), point]);
	}
	const dates = [...grouped.keys()].sort();
	const first = input.period?.startDate ?? dates[0];
	const lastDate = dates.at(-1);
	const last =
		input.period?.endDate ??
		(lastDate === undefined
			? undefined
			: addCalendarDays(addCalendarUnits(lastDate, input.grouping, 1), -1));
	if (first === undefined || last === undefined) {
		return [];
	}
	const buckets: CalendarBucket<Point>[] = [];
	for (
		let date = startOfCalendarUnit(first, input.grouping);
		date <= last;
		date = addCalendarUnits(date, input.grouping, 1)
	) {
		const endDate = addCalendarDays(addCalendarUnits(date, input.grouping, 1), -1);
		buckets.push({
			date,
			points: grouped.get(date) ?? [],
			period: calendarPeriod(
				date < first ? first : date,
				endDate > last ? last : endDate,
				input.timeZone,
			),
		});
	}
	return buckets;
};

const reportingRangePresets = [
	{ label: "Last 7 days", range: { days: 7, kind: "rolling" } },
	{ label: "Last 30 days", range: { days: 30, kind: "rolling" } },
	{ label: "Last 90 days", range: { days: 90, kind: "rolling" } },
	{ label: "Last 365 days", range: { days: 365, kind: "rolling" } },
	{ label: "This week", range: { offset: 0, unit: "week", kind: "calendar" } },
	{ label: "Previous week", range: { offset: -1, unit: "week", kind: "calendar" } },
	{ label: "This month", range: { offset: 0, unit: "month", kind: "calendar" } },
	{ label: "Previous month", range: { offset: -1, unit: "month", kind: "calendar" } },
	{ label: "This year", range: { offset: 0, unit: "year", kind: "calendar" } },
	{ label: "Previous year", range: { offset: -1, unit: "year", kind: "calendar" } },
] as const satisfies ReadonlyArray<{ readonly label: string; readonly range: ReportingRange }>;

export const reportingRangeValue = (range: ReportingRange) => {
	if (range.kind === "rolling") {
		return `rolling-${range.days}`;
	}
	if (range.kind === "calendar") {
		return `${range.offset === 0 ? "this" : "previous"}-${range.unit}`;
	}
	return range.kind;
};

/** Date range choices keyed by their `range` search-parameter value; `custom` reads `start`/`end`. */
export const reportingRangeOptions: ReadonlyArray<{
	readonly value: string;
	readonly label: string;
	readonly range: null | ReportingRange;
}> = [
	...reportingRangePresets.map(({ label, range }) => ({
		label,
		range,
		value: reportingRangeValue(range),
	})),
	{ range: null, value: "custom", label: "Custom dates" },
	{ value: "all-time", label: "All time", range: { kind: "all-time" } },
];

export const reportingSearchParams = (selection: ReportingSelection) => ({
	group: selection.grouping,
	compare: selection.comparison,
	range: reportingRangeValue(selection.range),
	end: selection.range.kind === "custom" ? selection.range.endDate : null,
	start: selection.range.kind === "custom" ? selection.range.startDate : null,
});

export const parseReportingSearch = (search: string): ReportingSelection => {
	const params = new URLSearchParams(search);
	const value = params.get("range");
	const option = reportingRangeOptions.find((candidate) => candidate.value === value);
	const custom = Schema.decodeUnknownResult(ReportingRange)({
		kind: "custom",
		endDate: params.get("end"),
		startDate: params.get("start"),
	});
	let range = defaultReportingSelection.range;
	if (value === "custom" && Result.isSuccess(custom)) {
		range = custom.success;
	} else if (option?.range) {
		range = option.range;
	}
	const grouping = params.get("group");
	const comparison = params.get("compare");
	return {
		range,
		grouping: Schema.is(ReportingGrouping)(grouping)
			? grouping
			: defaultReportingSelection.grouping,
		comparison: Schema.is(ReportingSelection.fields.comparison)(comparison)
			? comparison
			: defaultReportingSelection.comparison,
	};
};
