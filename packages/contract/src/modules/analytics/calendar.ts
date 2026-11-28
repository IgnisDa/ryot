import type { WeekDay } from "@ryot-app/i18n/locale";
import { DateTime, Duration } from "effect";

import { type TimeZone, UTC } from "../../schema/time-zone";

export type CalendarUnit = "day" | "week" | "year" | "month";

const calendarDateTime = (date: string) => DateTime.makeUnsafe(`${date}T00:00:00.000Z`);

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

/**
 * The first instant at which `dueAt`, `delayDays` later, has arrived: an instant at itself, and a
 * date at the start of its UTC calendar day in `timeZone`.
 */
export const dueFrom = (input: {
	dueAt: string;
	timeZone: TimeZone;
	delayDays: null | number;
	precision: "date" | "instant";
}) => {
	const shifted = DateTime.add(DateTime.makeUnsafe(input.dueAt), { days: input.delayDays ?? 0 });
	return input.precision === "date"
		? DateTime.toDate(
				DateTime.makeUnsafe(
					startOfLocalDay(localDateOf(DateTime.toDate(shifted), UTC), input.timeZone),
				),
			)
		: DateTime.toDate(shifted);
};

export const addCalendarDays = (date: string, days: number) =>
	DateTime.formatIsoDate(DateTime.add(calendarDateTime(date), { days }));

export const calendarDaysBetween = (from: string, until: string) =>
	Duration.toDays(DateTime.distance(calendarDateTime(from), calendarDateTime(until)));

export const startOfCalendarUnit = (date: string, unit: CalendarUnit, weekStartsOn: WeekDay) =>
	DateTime.formatIsoDate(DateTime.startOf(calendarDateTime(date), unit, { weekStartsOn }));

const unitParts = {
	day: (days: number) => ({ days }),
	week: (weeks: number) => ({ weeks }),
	year: (years: number) => ({ years }),
	month: (months: number) => ({ months }),
} satisfies Record<CalendarUnit, (count: number) => Partial<DateTime.DateTime.PartsForMath>>;

export const addCalendarUnits = (date: string, unit: CalendarUnit, count: number) =>
	DateTime.formatIsoDate(DateTime.add(calendarDateTime(date), unitParts[unit](count)));
