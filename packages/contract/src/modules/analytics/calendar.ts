import { DateTime } from "effect";

import type { TimeZone } from "../../schema/time-zone";

export type CalendarUnit = "day" | "week" | "year" | "month";

const DAY_MS = 86_400_000;

const dateMillis = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

const isoDate = (millis: number) => new Date(millis).toISOString().slice(0, 10);

export const isCalendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Date-only values carry no zone and are returned unchanged. */
export const localDateOf = (at: Date | number | string, timeZone: TimeZone) =>
	typeof at === "string" && isCalendarDate(at)
		? at
		: DateTime.formatIsoDate(DateTime.makeZonedUnsafe(at, { timeZone }));

export const startOfLocalDay = (date: string, timeZone: TimeZone) =>
	DateTime.formatIso(
		DateTime.makeZonedUnsafe(`${date}T00:00:00`, { timeZone, adjustForTimeZone: true }),
	);

export const addCalendarDays = (date: string, days: number) =>
	isoDate(dateMillis(date) + days * DAY_MS);

export const calendarDaysBetween = (from: string, until: string) =>
	Math.round((dateMillis(until) - dateMillis(from)) / DAY_MS);

export const startOfCalendarUnit = (date: string, unit: CalendarUnit) => {
	if (unit === "year") {
		return `${date.slice(0, 4)}-01-01`;
	}
	if (unit === "month") {
		return `${date.slice(0, 7)}-01`;
	}
	return unit === "week"
		? addCalendarDays(date, -((new Date(dateMillis(date)).getUTCDay() + 6) % 7))
		: date;
};

export const addCalendarUnits = (date: string, unit: CalendarUnit, count: number) => {
	const next = new Date(dateMillis(date));
	if (unit === "year") {
		next.setUTCFullYear(next.getUTCFullYear() + count);
	} else if (unit === "month") {
		next.setUTCMonth(next.getUTCMonth() + count);
	} else {
		next.setUTCDate(next.getUTCDate() + count * (unit === "week" ? 7 : 1));
	}
	return next.toISOString().slice(0, 10);
};
