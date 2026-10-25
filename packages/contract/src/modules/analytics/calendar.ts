import { DateTime, Duration } from "effect";

import type { TimeZone } from "../../schema/time-zone";

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

export const addCalendarDays = (date: string, days: number) =>
	DateTime.formatIsoDate(DateTime.add(calendarDateTime(date), { days }));

export const calendarDaysBetween = (from: string, until: string) =>
	Duration.toDays(DateTime.distance(calendarDateTime(from), calendarDateTime(until)));

export const startOfCalendarUnit = (date: string, unit: CalendarUnit) =>
	DateTime.formatIsoDate(DateTime.startOf(calendarDateTime(date), unit, { weekStartsOn: 1 }));

const unitParts = {
	day: (days: number) => ({ days }),
	week: (weeks: number) => ({ weeks }),
	year: (years: number) => ({ years }),
	month: (months: number) => ({ months }),
} satisfies Record<CalendarUnit, (count: number) => Partial<DateTime.DateTime.PartsForMath>>;

export const addCalendarUnits = (date: string, unit: CalendarUnit, count: number) =>
	DateTime.formatIsoDate(DateTime.add(calendarDateTime(date), unitParts[unit](count)));
