import { DateTime, Option } from "effect";

const DATE_LABEL_OPTIONS = {
	day: "numeric",
	month: "short",
	year: "numeric",
	locale: "en-US",
} as const;

const localDate = (value: string) => DateTime.makeUnsafe(value);

export const formatDateOnlyLabel = (value: string) =>
	Option.match(DateTime.make(value), {
		onNone: () => value,
		onSome: (date) => DateTime.format(date, DATE_LABEL_OPTIONS),
	});

export const formatLocalDateKey = (value: string) =>
	DateTime.formatLocal(localDate(value), {
		day: "2-digit",
		locale: "en-CA",
		year: "numeric",
		month: "2-digit",
	});

export const formatLocalDateLabel = (value: string) =>
	DateTime.formatLocal(localDate(value), DATE_LABEL_OPTIONS);

export const formatLocalMonthDayLabel = (value: string) =>
	DateTime.formatLocal(localDate(value), {
		day: "numeric",
		month: "short",
		locale: "en-US",
	});

export const formatLocalYearLabel = (value: string) =>
	DateTime.formatLocal(localDate(value), { locale: "en-US", year: "numeric" });
