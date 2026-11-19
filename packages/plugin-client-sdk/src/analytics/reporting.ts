import { addCalendarDays, localDateOf } from "@ryot-app/contract/modules/analytics/calendar";
import {
	REPORTING_BUCKET_LIMIT,
	type ReportingClock,
	type ReportingRange,
	reportingRangeEntitlement,
	reportingRangePresets,
	reportingRangeValue,
	type ReportingSelection,
	resolveReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import type { Entitlement } from "@ryot-app/contract/schema/entitlement";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useCallback } from "react";

type CaptionPeriod = null | { readonly endDate: string; readonly startDate: string };

const calendarInstant = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

/** A readable period such as `Oct 2 – 31, 2026` in the viewer's locale; `null` is all time. */
export const periodCaption = (
	t: (message: Message) => Text,
	formatters: Formatters,
	period: CaptionPeriod,
): Text => {
	if (period === null) {
		return t(kernelMessage("sdk.reporting.all-time"));
	}
	const format = formatters.dateTime({
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	return Text(
		period.startDate === period.endDate
			? format.format(calendarInstant(period.startDate))
			: format.formatRange(calendarInstant(period.startDate), calendarInstant(period.endDate)),
	);
};

export const usePeriodCaption = () => {
	const t = useT();
	const formatters = useFormatters();
	return useCallback(
		(period: CaptionPeriod) => periodCaption(t, formatters, period),
		[t, formatters],
	);
};

/** A daily selection of at most `REPORTING_BUCKET_LIMIT` days ending at the period end or today. */
export const consistencySelection = (
	input: Omit<ReportingClock, "now"> & { readonly selection: ReportingSelection },
	now: number,
) => {
	const current = resolveReportingSelection(input.selection, {
		now,
		timeZone: input.timeZone,
		weekStart: input.weekStart,
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
		? kernelMessage("sdk.reporting.range-last-days", { days: range.days })
		: kernelMessage("sdk.reporting.range-calendar", {
				unit: range.unit,
				position: range.offset === 0 ? "current" : "previous",
			});

export const reportingRangeOptions: ReadonlyArray<{
	readonly value: string;
	readonly label: Message;
	readonly range: null | ReportingRange;
	readonly entitlement: undefined | Entitlement;
}> = [
	...reportingRangePresets.map((range) => ({ range, label: rangeLabel(range) })),
	{ range: null, label: kernelMessage("sdk.reporting.range-custom") },
	{ range: { kind: "all-time" } as const, label: kernelMessage("sdk.reporting.all-time") },
].map((option) => {
	const value = option.range === null ? "custom" : reportingRangeValue(option.range);
	return Object.assign({}, option, { value, entitlement: reportingRangeEntitlement(value) });
});
