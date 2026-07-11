import { DateTime, Option } from "@ryot/sandbox-sdk/effect";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Captured = {
	day: string;
	year: string;
	month: string;
	hours: string;
	minutes: string;
	seconds: string;
	offset: string | null;
};

type CapturedKey = keyof Captured;

const buildMatcher = (format: string) => {
	const order: CapturedKey[] = [];
	let pattern = "";
	let index = 0;
	while (index < format.length) {
		const character = format[index] ?? "";
		if (character === "[") {
			const end = format.indexOf("]", index);
			if (end === -1) {
				pattern += escapeRegex(character);
				index += 1;
				continue;
			}
			pattern += escapeRegex(format.slice(index + 1, end));
			index = end + 1;
			continue;
		}
		if (format.startsWith("YYYY", index)) {
			order.push("year");
			pattern += "(\\d{4})";
			index += 4;
		} else if (format.startsWith("MM", index)) {
			order.push("month");
			pattern += "(\\d{2})";
			index += 2;
		} else if (format.startsWith("DD", index)) {
			order.push("day");
			pattern += "(\\d{2})";
			index += 2;
		} else if (format.startsWith("HH", index)) {
			order.push("hours");
			pattern += "(\\d{2})";
			index += 2;
		} else if (format.startsWith("mm", index)) {
			order.push("minutes");
			pattern += "(\\d{2})";
			index += 2;
		} else if (format.startsWith("ss", index)) {
			order.push("seconds");
			pattern += "(\\d{2})";
			index += 2;
		} else if (character === "Z") {
			order.push("offset");
			pattern += "(Z|[+-]\\d{2}:?\\d{2})";
			index += 1;
		} else {
			pattern += escapeRegex(character);
			index += 1;
		}
	}
	return { order, regex: new RegExp(`^${pattern}$`) };
};

const matchFormat = (value: string, format: string) => {
	const { regex, order } = buildMatcher(format);
	const match = regex.exec(value);
	if (!match) {
		return null;
	}
	const captured: Captured = {
		day: "01",
		offset: null,
		year: "1970",
		month: "01",
		hours: "00",
		minutes: "00",
		seconds: "00",
	};
	order.forEach((key, index) => {
		const capturedValue = match[index + 1];
		if (capturedValue === undefined) {
			return;
		}
		if (key === "offset") {
			captured.offset = capturedValue;
		} else {
			captured[key] = capturedValue;
		}
	});
	return captured;
};

const formatIsoFromUtc = (iso: string) =>
	Option.match(DateTime.make(iso), {
		onNone: () => null,
		onSome: (instant) => DateTime.formatIso(instant),
	});

export const parseDateWithFormat = (value: string, format: string) => {
	const captured = matchFormat(value.trim(), format);
	return captured ? formatIsoFromUtc(`${captured.year}-${captured.month}-${captured.day}`) : null;
};

export const parseDateTime = (value: string, formats: string[]) => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	for (const format of formats) {
		const captured = matchFormat(trimmed, format);
		if (!captured) {
			continue;
		}
		const offset = captured.offset === null || captured.offset === "Z" ? "Z" : captured.offset;
		const iso = formatIsoFromUtc(
			`${captured.year}-${captured.month}-${captured.day}T${captured.hours}:${captured.minutes}:${captured.seconds}${offset}`,
		);
		if (iso) {
			return iso;
		}
	}
	const normalized = trimmed.replace(" ", "T");
	const withZone =
		!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized) && /\d{2}:\d{2}/.test(normalized)
			? `${normalized}Z`
			: normalized;
	return formatIsoFromUtc(withZone);
};

export const parseZonedDateTime = (value: string, formats: string[], timeZone: string) => {
	for (const format of formats) {
		const captured = matchFormat(value.trim(), format);
		if (!captured) {
			continue;
		}
		const iso = Option.match(
			DateTime.makeZoned(
				{
					day: Number(captured.day),
					year: Number(captured.year),
					month: Number(captured.month),
					hours: Number(captured.hours),
					minutes: Number(captured.minutes),
					seconds: Number(captured.seconds),
				},
				{ timeZone, adjustForTimeZone: true },
			),
			{ onNone: () => null, onSome: (zoned) => DateTime.formatIso(DateTime.toUtc(zoned)) },
		);
		if (iso) {
			return iso;
		}
	}
	return null;
};

export const getOccurredAtValue = (value: string) =>
	Option.match(DateTime.make(value), {
		onNone: () => 0,
		onSome: (instant) => DateTime.toEpochMillis(instant),
	});

export const nowIso = () => DateTime.formatIso(DateTime.unsafeNow());

export const parseDateInput = (
	value: number | string | null | undefined,
	options: { unixSeconds?: boolean } = {},
) => {
	if (typeof value === "number") {
		const milliseconds = options.unixSeconds ? value * 1000 : value;
		return Number.isFinite(milliseconds)
			? Option.match(DateTime.make(milliseconds), {
					onNone: () => null,
					onSome: (instant) => DateTime.formatIso(instant),
				})
			: null;
	}
	return typeof value === "string" && value.trim() ? formatIsoFromUtc(value.trim()) : null;
};
