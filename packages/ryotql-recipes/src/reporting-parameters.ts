import {
	addCalendarDays,
	calendarDaysBetween,
} from "@ryot-app/contract/modules/analytics/calendar";
import {
	REPORTING_BUCKET_LIMIT,
	type ReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	and,
	castDate,
	conditional,
	dateBucket,
	eq,
	gte,
	literal,
	localDate,
	lt,
	not,
	or,
} from "@ryot-app/ryotql";
import { dateAdd, now, parameters, reportingTimeZone } from "@ryot-app/ryotql/authoring";

const offset = (label: string, defaultValue: number) => ({
	label,
	defaultValue,
	type: "integer" as const,
	description: "Calendar offset from the executing user's current reporting date or period",
});
const customDate = (label: string) => ({
	label,
	type: "date" as const,
	defaultValue: "1970-01-01",
	description: "Inclusive calendar date used for a custom reporting period",
});
export const reportingParameterFields = {
	customEndDate: customDate("Custom last day"),
	customStartDate: customDate("Custom first day"),
	startOffsetDays: offset("First day offset", -29),
	endOffsetDays: offset("Exclusive last day offset", 1),
	customPreviousEndDate: customDate("Comparison last day"),
	customPreviousStartDate: customDate("Comparison first day"),
	calendarStartOffset: offset("First calendar period offset", 0),
	previousStartOffsetDays: offset("Comparison first day offset", -59),
	calendarEndOffset: offset("Exclusive last calendar period offset", 1),
	previousEndOffsetDays: offset("Comparison exclusive last day offset", -29),
	previousCalendarStartOffset: offset("Comparison calendar period offset", -1),
	previousCalendarEndOffset: offset("Comparison exclusive calendar period offset", 0),
	consistency: {
		type: "boolean",
		defaultValue: false,
		label: "Daily consistency",
		description:
			"Read at most the latest reporting bucket limit of civil days within the selected period, without comparison",
	},
	comparison: {
		type: "enum",
		label: "Comparison",
		defaultValue: "none",
		description: "Include the preceding reporting period when requested",
		choices: { kind: "static", values: [{ value: "none" }, { value: "previous-period" }] },
	},
	comparisonSide: {
		type: "enum",
		defaultValue: "current",
		label: "Comparison period",
		description: "Read the selected period or its preceding comparison period",
		choices: { kind: "static", values: [{ value: "current" }, { value: "previous" }] },
	},
	grouping: {
		type: "enum",
		label: "Grouping",
		defaultValue: "day",
		description: "Calendar unit used to group observations",
		choices: {
			kind: "static",
			values: [
				{ value: "auto" },
				{ value: "day" },
				{ value: "week" },
				{ value: "month" },
				{ value: "year" },
			],
		},
	},
	range: {
		type: "enum",
		label: "Period",
		defaultValue: "rolling",
		description: "Reporting period, resolved with the server clock and account time zone",
		choices: {
			kind: "static",
			values: [
				{ value: "all-time" },
				{ value: "rolling" },
				{ value: "week" },
				{ value: "month" },
				{ value: "year" },
				{ value: "custom" },
			],
		},
	},
} as const;

export const reportingParameters = parameters({ fields: reportingParameterFields });
const today = castDate(localDate(now(), { timeZone: reportingTimeZone }));
const consistency = () => eq(reportingParameters.value("consistency"), literal(true));
const comparisonExpression = (
	current: ScalarExpression,
	previous: ScalarExpression,
	selected?: "current" | "previous",
) => {
	if (selected === "current") {
		return current;
	}
	if (selected === "previous") {
		return previous;
	}
	return conditional(
		consistency(),
		current,
		reportingParameters.choice("comparisonSide", { current, previous }),
	);
};
const calendar = (unit: "week" | "year" | "month", selected?: "current" | "previous") => {
	const anchor = castDate(
		localDate(dateBucket(now(), { bucket: unit, timeZone: reportingTimeZone }), {
			timeZone: reportingTimeZone,
		}),
	);
	return {
		endDate: comparisonExpression(
			dateAdd(anchor, reportingParameters.value("calendarEndOffset"), unit),
			dateAdd(anchor, reportingParameters.value("previousCalendarEndOffset"), unit),
			selected,
		),
		startDate: comparisonExpression(
			dateAdd(anchor, reportingParameters.value("calendarStartOffset"), unit),
			dateAdd(anchor, reportingParameters.value("previousCalendarStartOffset"), unit),
			selected,
		),
	};
};
const periodsFor = (selected?: "current" | "previous") => ({
	week: calendar("week", selected),
	year: calendar("year", selected),
	month: calendar("month", selected),
	custom: {
		startDate: comparisonExpression(
			reportingParameters.value("customStartDate"),
			reportingParameters.value("customPreviousStartDate"),
			selected,
		),
		endDate: comparisonExpression(
			dateAdd(reportingParameters.value("customEndDate"), 1, "day"),
			dateAdd(reportingParameters.value("customPreviousEndDate"), 1, "day"),
			selected,
		),
	},
	rolling: {
		endDate: comparisonExpression(
			dateAdd(today, reportingParameters.value("endOffsetDays"), "day"),
			dateAdd(today, reportingParameters.value("previousEndOffsetDays"), "day"),
			selected,
		),
		startDate: comparisonExpression(
			dateAdd(today, reportingParameters.value("startOffsetDays"), "day"),
			dateAdd(today, reportingParameters.value("previousStartOffsetDays"), "day"),
			selected,
		),
	},
});
type Period = { readonly endDate: ScalarExpression; readonly startDate: ScalarExpression };
const between = (date: ScalarExpression, period: Period) =>
	and(gte(date, period.startDate), lt(date, period.endDate));
const allTimeConsistencyPeriod = (): Period => ({
	endDate: dateAdd(today, 1, "day"),
	startDate: dateAdd(today, 1 - REPORTING_BUCKET_LIMIT, "day"),
});
const isUnbounded = () =>
	and(not(consistency()), eq(reportingParameters.value("range"), literal("all-time")));
const selectedPeriod = (selectedSide?: "current" | "previous"): Period => {
	const periods = periodsFor(selectedSide);
	const allTime = allTimeConsistencyPeriod();
	const startDate = reportingParameters.choice("range", {
		week: periods.week.startDate,
		year: periods.year.startDate,
		"all-time": allTime.startDate,
		month: periods.month.startDate,
		custom: periods.custom.startDate,
		rolling: periods.rolling.startDate,
	});
	const endDate = reportingParameters.choice("range", {
		week: periods.week.endDate,
		year: periods.year.endDate,
		"all-time": allTime.endDate,
		month: periods.month.endDate,
		custom: periods.custom.endDate,
		rolling: periods.rolling.endDate,
	});
	return { endDate, startDate };
};
const consistencyPeriod = (period: Period): Period => {
	const cutoff = dateAdd(period.endDate, -REPORTING_BUCKET_LIMIT, "day");
	const clippedStart = conditional(
		gte(castDate(period.startDate), cutoff),
		period.startDate,
		cutoff,
	);
	return {
		endDate: period.endDate,
		startDate: conditional(consistency(), clippedStart, period.startDate),
	};
};
const comparisonEnabled = () =>
	and(
		eq(reportingParameters.value("comparison"), literal("previous-period")),
		not(eq(reportingParameters.value("range"), literal("all-time"))),
	);
const sideEnabled = (selectedSide?: "current" | "previous") => {
	if (selectedSide === "current") {
		return and();
	}
	if (selectedSide === "previous") {
		return and(not(consistency()), comparisonEnabled());
	}
	return or(
		consistency(),
		not(eq(reportingParameters.value("comparisonSide"), literal("previous"))),
		comparisonEnabled(),
	);
};
export const reportingDatePredicate = (
	date: ScalarExpression,
	selectedSide?: "current" | "previous",
) => {
	const predicate = or(
		isUnbounded(),
		between(castDate(date), consistencyPeriod(selectedPeriod(selectedSide))),
	);
	return and(sideEnabled(selectedSide), predicate);
};
export const reportingPeriodPredicate = (
	at: ScalarExpression,
	selectedSide?: "current" | "previous",
) => reportingDatePredicate(localDate(at, { timeZone: reportingTimeZone }), selectedSide);
export const reportingSincePredicate = (at: ScalarExpression) =>
	and(
		sideEnabled(),
		or(
			isUnbounded(),
			gte(
				castDate(localDate(at, { timeZone: reportingTimeZone })),
				consistencyPeriod(selectedPeriod()).startDate,
			),
		),
	);

export const expressionPeriodPredicate = (
	at: ScalarExpression,
	period: { readonly endAt: ScalarExpression; readonly startAt: ScalarExpression },
) => and(gte(at, period.startAt), lt(at, period.endAt));

export const reportingArguments = (
	selection: ReportingSelection,
	comparisonSide: "current" | "previous" = "current",
) => {
	const range = selection.range;
	let days = 0;
	if (range.kind === "rolling") {
		days = range.days;
	}
	if (range.kind === "custom") {
		days = calendarDaysBetween(range.startDate, range.endDate) + 1;
	}
	return {
		comparisonSide,
		grouping: selection.grouping,
		comparison: selection.comparison,
		range: range.kind === "calendar" ? range.unit : range.kind,
		...(range.kind === "rolling"
			? {
					endOffsetDays: 1,
					startOffsetDays: 1 - days,
					previousEndOffsetDays: 1 - days,
					previousStartOffsetDays: 1 - days * 2,
				}
			: {}),
		...(range.kind === "calendar"
			? {
					calendarStartOffset: range.offset,
					calendarEndOffset: range.offset + 1,
					previousCalendarEndOffset: range.offset,
					previousCalendarStartOffset: range.offset - 1,
				}
			: {}),
		...(range.kind === "custom"
			? {
					customEndDate: range.endDate,
					customStartDate: range.startDate,
					customPreviousEndDate: addCalendarDays(range.startDate, -1),
					customPreviousStartDate: addCalendarDays(range.startDate, -days),
				}
			: {}),
	};
};

export const reportingWindow = (selectedSide?: "current" | "previous") => {
	const period = consistencyPeriod(selectedPeriod(selectedSide));
	return {
		unbounded: and(sideEnabled(selectedSide), isUnbounded()),
		where: (at: ScalarExpression) => reportingPeriodPredicate(at, selectedSide),
		dateWhere: (date: ScalarExpression) => reportingDatePredicate(date, selectedSide),
		superset: (at: ScalarExpression, paddingDays: number) =>
			and(
				sideEnabled(selectedSide),
				or(
					isUnbounded(),
					and(
						gte(at, dateAdd(period.startDate, -paddingDays, "day")),
						lt(at, dateAdd(period.endDate, paddingDays, "day")),
					),
				),
			),
	};
};
export const expressionDateWindow = (startDate: ScalarExpression, endDate: ScalarExpression) => ({
	unbounded: eq(literal(false), literal(true)),
	dateWhere: (date: ScalarExpression) => between(castDate(date), { endDate, startDate }),
	where: (at: ScalarExpression) =>
		between(castDate(localDate(at, { timeZone: reportingTimeZone })), { endDate, startDate }),
	superset: (at: ScalarExpression, paddingDays: number) =>
		and(
			gte(at, dateAdd(startDate, -paddingDays, "day")),
			lt(at, dateAdd(endDate, paddingDays, "day")),
		),
});
export type ReportingWindow = ReturnType<typeof reportingWindow>;

export const reportingGroupingExpression = (
	group: (unit: "day" | "week" | "year" | "month") => ScalarExpression,
): ScalarExpression => {
	const period = selectedPeriod("current");
	const lastDate = dateAdd(castDate(period.endDate), -1, "day");
	const fits = (unit: "day" | "week" | "month") =>
		lt(
			lastDate,
			dateAdd(
				dateBucket(castDate(period.startDate), { bucket: unit, timeZone: TimeZone.make("UTC") }),
				REPORTING_BUCKET_LIMIT,
				unit,
			),
		);
	const atMost = (days: number) => lt(lastDate, dateAdd(castDate(period.startDate), days, "day"));
	const yes = and();
	const no = eq(literal(false), literal(true));
	const allowedDay = reportingParameters.choice("grouping", {
		day: yes,
		week: no,
		year: no,
		month: no,
		auto: atMost(90),
	});
	const allowedWeek = reportingParameters.choice("grouping", {
		day: yes,
		year: no,
		week: yes,
		month: no,
		auto: atMost(730),
	});
	const allowedMonth = reportingParameters.choice("grouping", {
		day: yes,
		year: no,
		week: yes,
		month: yes,
		auto: atMost(3653),
	});
	const bounded = not(eq(reportingParameters.value("range"), literal("all-time")));
	return conditional(
		or(consistency(), and(bounded, allowedDay, fits("day"))),
		group("day"),
		conditional(
			and(bounded, allowedWeek, fits("week")),
			group("week"),
			conditional(and(bounded, allowedMonth, fits("month")), group("month"), group("year")),
		),
	);
};
