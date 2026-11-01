import { DateTime, Option, Result, Schema } from "effect";

export const isNamedTimeZone = (value: string) =>
	!/^[-+]\d{2}(?::?\d{2})?$/.test(value) && Option.isSome(DateTime.zoneMakeNamed(value));

export const TimeZone = Schema.String.check(
	Schema.makeFilter((value) => isNamedTimeZone(value) || "Expected an IANA time zone"),
).pipe(Schema.brand("TimeZone"));
export type TimeZone = typeof TimeZone.Type;

export const UTC = TimeZone.make("UTC");

export const deviceTimeZone = (
	read: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): TimeZone => {
	const zone = Result.try(read);
	return Result.isSuccess(zone) && zone.success !== undefined
		? Option.getOrElse(Schema.decodeOption(TimeZone)(zone.success), () => UTC)
		: UTC;
};
