import { DateTime, Option } from "effect";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const buildMatcher = (format: string): { regex: RegExp; order: CapturedKey[] } => {
	const order: CapturedKey[] = [];
	let pattern = "";
	let i = 0;
	while (i < format.length) {
		const ch = format[i] ?? "";
		if (ch === "[") {
			const end = format.indexOf("]", i);
			if (end === -1) {
				pattern += escapeRegex(ch);
				i += 1;
				continue;
			}
			pattern += escapeRegex(format.slice(i + 1, end));
			i = end + 1;
			continue;
		}
		if (format.startsWith("YYYY", i)) {
			order.push("year");
			pattern += "(\\d{4})";
			i += 4;
		} else if (format.startsWith("MM", i)) {
			order.push("month");
			pattern += "(\\d{2})";
			i += 2;
		} else if (format.startsWith("DD", i)) {
			order.push("day");
			pattern += "(\\d{2})";
			i += 2;
		} else if (format.startsWith("HH", i)) {
			order.push("hours");
			pattern += "(\\d{2})";
			i += 2;
		} else if (format.startsWith("mm", i)) {
			order.push("minutes");
			pattern += "(\\d{2})";
			i += 2;
		} else if (format.startsWith("ss", i)) {
			order.push("seconds");
			pattern += "(\\d{2})";
			i += 2;
		} else if (ch === "Z") {
			order.push("offset");
			pattern += "(Z|[+-]\\d{2}:?\\d{2})";
			i += 1;
		} else {
			pattern += escapeRegex(ch);
			i += 1;
		}
	}
	return { order, regex: new RegExp(`^${pattern}$`) };
};

const matchFormat = (value: string, format: string): Captured | null => {
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
		const internalValue = match[index + 1];
		if (internalValue === undefined) {
			return;
		}
		if (key === "offset") {
			captured.offset = internalValue;
		} else {
			captured[key] = internalValue;
		}
	});
	return captured;
};

const formatIsoFromUtc = (iso: string): string | null =>
	Option.match(DateTime.make(iso), {
		onNone: () => null,
		onSome: (instant) => DateTime.formatIso(instant),
	});

export const parseDateWithFormat = (value: string, format: string): string | null => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const captured = matchFormat(trimmed, format);
	return captured ? formatIsoFromUtc(`${captured.year}-${captured.month}-${captured.day}`) : null;
};

export const parseDateTime = (value: string, formats: string[]): string | null => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	for (const format of formats) {
		const captured = matchFormat(trimmed, format);
		if (captured) {
			const offset = captured.offset === null || captured.offset === "Z" ? "Z" : captured.offset;
			const iso = formatIsoFromUtc(
				`${captured.year}-${captured.month}-${captured.day}T${captured.hours}:${captured.minutes}:${captured.seconds}${offset}`,
			);
			if (iso) {
				return iso;
			}
		}
	}

	const normalized = trimmed.replace(" ", "T");
	const withZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)
		? normalized
		: /\d{2}:\d{2}/.test(normalized)
			? `${normalized}Z`
			: normalized;
	return formatIsoFromUtc(withZone);
};

export const parseZonedDateTime = (
	value: string,
	formats: string[],
	timeZone: string,
): string | null => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	for (const format of formats) {
		const captured = matchFormat(trimmed, format);
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

export const getOccurredAtValue = (value: string): number =>
	Option.match(DateTime.make(value), {
		onNone: () => 0,
		onSome: (instant) => DateTime.toEpochMillis(instant),
	});

export const nowIso = (): string => DateTime.formatIso(DateTime.unsafeNow());

export const parseDateInput = (
	value: number | string | null | undefined,
	options: { unixSeconds?: boolean } = {},
): string | null => {
	if (typeof value === "number") {
		const milliseconds = options.unixSeconds ? value * 1000 : value;
		if (!Number.isFinite(milliseconds)) {
			return null;
		}
		return Option.match(DateTime.make(milliseconds), {
			onNone: () => null,
			onSome: (instant) => DateTime.formatIso(instant),
		});
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? formatIsoFromUtc(trimmed) : null;
	}
	return null;
};
