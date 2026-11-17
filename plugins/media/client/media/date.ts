import { calendarDaysBetween, deviceTimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import { type Formatters, localDay } from "@ryot-app/plugin-client-sdk/react";

const localDate = (value: string) => Date.parse(value);

export const formatDateOnlyLabel = (formatters: Formatters, value: string) => {
	const date = Date.parse(value);
	return Number.isNaN(date)
		? value
		: formatters
				.dateTime({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
				.format(date);
};

export const formatLocalDateKey = (value: string) => localDay(localDate(value));

export const formatLocalDateTimeLabel = (formatters: Formatters, value: string) =>
	formatters
		.dateTime({
			day: "numeric",
			month: "short",
			hour: "numeric",
			weekday: "short",
			minute: "2-digit",
			timeZone: deviceTimeZone(),
		})
		.format(localDate(value));

export const formatLocalMonthDayLabel = (formatters: Formatters, value: string) =>
	formatters
		.dateTime({ day: "numeric", month: "short", timeZone: deviceTimeZone() })
		.format(localDate(value));

export const formatLocalMonthLabel = (formatters: Formatters, value: string) =>
	formatters
		.dateTime({ month: "long", year: "numeric", timeZone: deviceTimeZone() })
		.format(localDate(value));

export const formatLocalYearLabel = (formatters: Formatters, value: string) =>
	formatters.dateTime({ year: "numeric", timeZone: deviceTimeZone() }).format(localDate(value));

export const localDayCount = (earliest: string, latest: string) =>
	Math.abs(calendarDaysBetween(formatLocalDateKey(earliest), formatLocalDateKey(latest))) + 1;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole years from `start` to `end`, both `YYYY-MM-DD`; `undefined` for any other input or when `end` precedes `start`. */
export const completedYearsBetween = (start: string, end: string) => {
	if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
		return undefined;
	}
	const years = Number(end.slice(0, 4)) - Number(start.slice(0, 4));
	const completed = end.slice(5) < start.slice(5) ? years - 1 : years;
	return completed < 0 ? undefined : completed;
};
