import { DateTime, Result, Schema } from "effect";

import { isNamedTimeZone, IsoUtcString, strictStruct } from "../../schema/utils";

export const ReportingTimeZone = Schema.String.check(
	Schema.makeFilter((value) => isNamedTimeZone(value) || "Expected an IANA time zone"),
);

export const ReportingPreferences = strictStruct({ timeZone: ReportingTimeZone });
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

export const reportingSelectionSearch = (selection: ReportingSelection): string =>
	new URLSearchParams({ reporting: JSON.stringify(selection) }).toString();

export const parseReportingSelection = (search: string): ReportingSelection => {
	const encoded = new URLSearchParams(search).get("reporting");
	if (encoded === null) {
		return defaultReportingSelection;
	}
	const parsed = Result.try((): unknown => JSON.parse(encoded));
	if (Result.isFailure(parsed)) {
		return defaultReportingSelection;
	}
	const decoded = Schema.decodeUnknownResult(ReportingSelection)(parsed.success);
	return Result.isSuccess(decoded) ? decoded.success : defaultReportingSelection;
};

export const ReportingPeriod = strictStruct({
	endAt: IsoUtcString,
	endDate: CalendarDate,
	startAt: IsoUtcString,
	startDate: CalendarDate,
});
export type ReportingPeriod = typeof ReportingPeriod.Type;

const automaticGrouping = (days: number): Exclude<typeof ReportingGrouping.Type, "auto"> => {
	if (days <= 90) {
		return "day";
	}
	if (days <= 730) {
		return "week";
	}
	if (days <= 3653) {
		return "month";
	}
	return "year";
};

const calendarStep = { week: { weeks: 1 }, year: { years: 1 }, month: { months: 1 } };

const period = (start: DateTime.Utc, end: DateTime.Utc, timeZone: string): ReportingPeriod => ({
	startDate: DateTime.formatIsoDate(start),
	endDate: DateTime.formatIsoDate(DateTime.subtract(end, { days: 1 })),
	endAt: DateTime.formatIso(DateTime.makeZonedUnsafe(end, { timeZone, adjustForTimeZone: true })),
	startAt: DateTime.formatIso(
		DateTime.makeZonedUnsafe(start, { timeZone, adjustForTimeZone: true }),
	),
});

const calendarDays = (start: DateTime.Utc, end: DateTime.Utc) =>
	Math.round(
		(Date.parse(DateTime.formatIsoDate(end)) - Date.parse(DateTime.formatIsoDate(start))) /
			86_400_000,
	);

export const resolveReportingSelection = (
	selection: ReportingSelection,
	input: { readonly now: number; readonly timeZone: string },
) => {
	const timeZone = Schema.decodeSync(ReportingTimeZone)(input.timeZone);
	const today = DateTime.makeUnsafe(
		DateTime.formatIsoDate(DateTime.makeZonedUnsafe(input.now, { timeZone })),
	);
	const range = selection.range;
	if (range.kind === "all-time") {
		return {
			timeZone,
			current: null,
			previous: null,
			grouping: selection.grouping === "auto" ? ("year" as const) : selection.grouping,
		};
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
	const days = calendarDays(start, end);
	return {
		timeZone,
		current: period(start, end, timeZone),
		grouping: selection.grouping === "auto" ? automaticGrouping(days) : selection.grouping,
		previous:
			selection.comparison === "previous-period" ? period(previousStart, start, timeZone) : null,
	};
};

export type ResolvedReportingSelection = ReturnType<typeof resolveReportingSelection>;

export const reportingSelectionKey = (selection: ReportingSelection, timeZone: string) => ({
	timeZone,
	selection,
});
