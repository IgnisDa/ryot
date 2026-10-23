import { DateTime, Option } from "@ryot-app/plugin-client-sdk/effect";

export const toDateTimeInput = (
	iso: string,
	timeZone: string | DateTime.TimeZone = DateTime.zoneMakeLocal(),
) => DateTime.formatIsoOffset(DateTime.makeZonedUnsafe(iso, { timeZone })).slice(0, 16);

export const resolveDateTimeInput = (
	value: string,
	original: string | null | undefined,
	occurrence?: string,
	timeZone: string | DateTime.TimeZone = DateTime.zoneMakeLocal(),
) => {
	const validFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
	const candidates = new Map<string, DateTime.Zoned>();
	for (const disambiguation of ["earlier", "later"] as const) {
		const candidate = validFormat
			? DateTime.makeZoned(value, { timeZone, disambiguation, adjustForTimeZone: true })
			: Option.none();
		if (
			Option.isSome(candidate) &&
			DateTime.formatIsoOffset(candidate.value).slice(0, 16) === value
		) {
			candidates.set(DateTime.formatIso(candidate.value), candidate.value);
		}
	}
	const choices = [...candidates].map(([iso, candidate], index) => ({
		value: iso,
		offset: DateTime.zonedOffset(candidate),
		label: `${index === 0 ? "First" : "Second"} occurrence (UTC${DateTime.zonedOffsetIso(candidate)})`,
	}));
	const previous = original == null ? Option.none() : DateTime.makeZoned(original, { timeZone });
	const previousLocal = Option.isSome(previous)
		? DateTime.formatIsoOffset(previous.value).slice(0, 16)
		: undefined;
	const previousOffset = Option.isSome(previous) ? DateTime.zonedOffset(previous.value) : undefined;
	let selected = choices.find((choice) => choice.value === occurrence);
	if (selected === undefined && choices.length === 1) {
		selected = choices[0];
	}
	if (selected === undefined && previousLocal?.slice(0, 10) === value.slice(0, 10)) {
		selected = choices.find((choice) => choice.offset === previousOffset);
	}
	let iso: string | null = selected?.value ?? null;
	if (
		selected !== undefined &&
		original != null &&
		previousLocal === value &&
		selected.offset === previousOffset
	) {
		iso = original;
	}
	let error: string | undefined;
	if (selected === undefined) {
		if (!validFormat) {
			error = "Enter a date and time.";
		} else if (choices.length === 0) {
			error = "This local date and time does not exist. Choose another time.";
		} else {
			error = "This local time occurs twice. Choose an occurrence.";
		}
	}
	return { iso, error, choices, occurrence: selected?.value ?? "" };
};
