import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { DateTime, Option } from "effect";

export const toDateTimeInput = (
	iso: string,
	timeZone: string | DateTime.TimeZone = DateTime.zoneMakeLocal(),
	precision: "minute" | "millisecond" = "minute",
) => {
	const zoned = DateTime.makeZoned(iso, { timeZone });
	if (Option.isNone(zoned)) {
		return iso;
	}
	const formatted = DateTime.formatIsoOffset(zoned.value);
	if (precision === "minute") {
		return formatted.slice(0, 16);
	}
	return formatted.slice(0, DateTime.toParts(zoned.value).millisecond === 0 ? 19 : 23);
};

export const resolveDateTimeInput = (
	value: string,
	original: null | string | undefined,
	occurrence?: string,
	timeZone: string | DateTime.TimeZone = DateTime.zoneMakeLocal(),
) => {
	const validFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value);
	const candidates = new Map<string, DateTime.Zoned>();
	for (const disambiguation of ["earlier", "later"] as const) {
		const candidate = validFormat
			? DateTime.makeZoned(value, { timeZone, disambiguation, adjustForTimeZone: true })
			: Option.none();
		if (
			Option.isSome(candidate) &&
			DateTime.formatIsoOffset(candidate.value).slice(0, value.length) === value
		) {
			candidates.set(DateTime.formatIso(candidate.value), candidate.value);
		}
	}
	const choices = [...candidates].map(([iso, candidate], index) => ({
		value: iso,
		offset: DateTime.zonedOffset(candidate),
		label: kernelMessage("ui.datetime.occurrence", {
			offset: DateTime.zonedOffsetIso(candidate),
			occurrence: index === 0 ? "first" : "second",
		}),
	}));
	const previous = original == null ? Option.none() : DateTime.makeZoned(original, { timeZone });
	const previousLocal = Option.isSome(previous)
		? DateTime.formatIsoOffset(previous.value).slice(0, value.length)
		: undefined;
	const previousOffset = Option.isSome(previous) ? DateTime.zonedOffset(previous.value) : undefined;
	let selected = choices.find((choice) => choice.value === occurrence);
	if (selected === undefined && choices.length === 1) {
		selected = choices[0];
	}
	if (selected === undefined && previousLocal?.slice(0, 10) === value.slice(0, 10)) {
		selected = choices.find((choice) => choice.offset === previousOffset);
	}
	let iso: null | string = selected?.value ?? null;
	if (
		selected !== undefined &&
		original != null &&
		previousLocal === value &&
		selected.offset === previousOffset
	) {
		iso = original;
	}
	let error: Message | undefined;
	if (selected === undefined) {
		if (!validFormat) {
			error = kernelMessage("ui.datetime.required");
		} else if (choices.length === 0) {
			error = kernelMessage("ui.datetime.nonexistent");
		} else {
			error = kernelMessage("ui.datetime.ambiguous");
		}
	}
	return { iso, error, choices, occurrence: selected?.value ?? "" };
};

/** An instant's day in the device time zone, such as `Mar 12, 2026`. */
export const formatDateLabel = (formatters: Formatters, value: string) =>
	formatters
		.dateTime({ day: "numeric", month: "short", year: "numeric", timeZone: deviceTimeZone() })
		.format(Date.parse(value));

const relativeDayUnits = [
	[365, "year"],
	[30, "month"],
	[7, "week"],
] as const;

/** Calendar days back in the largest whole unit, such as `yesterday` or `3 weeks ago`. */
export const formatDaysAgo = (formatters: Formatters, days: number) => {
	const [size, unit] = relativeDayUnits.find(([threshold]) => days >= threshold) ?? [1, "day"];
	return formatters
		.relativeTime({ numeric: "auto" })
		.format(-Math.floor(Math.max(0, days) / size), unit);
};
