import { DateTime, Option } from "@ryot-app/client-sdk/effect";

const DAY_MS = 86_400_000;

export const ACTIVITY_WEEKS = 52;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;

const isoDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

const shiftDate = (date: string, days: number) => isoDate(dayNumber(date) + days);

/** An IANA zone name, or `"UTC"`: the server buckets by name, so offsets and unknown names fall back. */
export const resolveTimeZone = (candidate: string | undefined) =>
	Option.match(
		Option.filter(
			DateTime.zoneMakeNamed(candidate ?? ""),
			(zone) => !/^[+-]/.test(DateTime.zoneToString(zone)),
		),
		{ onNone: () => "UTC", onSome: DateTime.zoneToString },
	);

const localMidnight = (date: string, timeZone: string) =>
	DateTime.formatIso(
		DateTime.makeZonedUnsafe(`${date}T00:00:00`, { timeZone, adjustForTimeZone: true }),
	);

export type ActivityWindow = {
	/** First local date shown, always a Monday. */
	readonly start: string;
	/** Last local date shown: today. */
	readonly end: string;
	/** Instant `start` begins in the time zone, inclusive. */
	readonly from: string;
	/** Instant the day after `end` begins in the time zone, exclusive. */
	readonly until: string;
};

/** The last 52 Monday-start weeks, the newest one ending today. */
export const activityWindow = (today: string, timeZone: string): ActivityWindow => {
	const daysSinceMonday = (new Date(dayNumber(today) * DAY_MS).getUTCDay() + 6) % 7;
	const start = shiftDate(today, -daysSinceMonday - (ACTIVITY_WEEKS - 1) * 7);
	return {
		start,
		end: today,
		from: localMidnight(start, timeZone),
		until: localMidnight(shiftDate(today, 1), timeZone),
	};
};

/** The local date of a day bucket, which the server reports as the instant that day begins. */
export const localDateOf = (instant: string, timeZone: string) =>
	DateTime.formatIsoDate(DateTime.makeZonedUnsafe(instant, { timeZone }));

/** One entry per date of the window, zero where nothing happened. */
export const activityDays = (
	window: ActivityWindow,
	counts: ReadonlyMap<string, number>,
): readonly { readonly date: string; readonly value: number }[] =>
	Array.from({ length: dayNumber(window.end) - dayNumber(window.start) + 1 }, (_, index) => {
		const date = shiftDate(window.start, index);
		return { date, value: counts.get(date) ?? 0 };
	});

/**
 * Consecutive active days ending today, or ending yesterday while today has no activity yet.
 */
export const activityStreak = (activeDates: ReadonlySet<string>, today: string) => {
	let date = activeDates.has(today) ? today : shiftDate(today, -1);
	let streak = 0;
	while (activeDates.has(date)) {
		streak += 1;
		date = shiftDate(date, -1);
	}
	return streak;
};

/** Whole percentages of the total that sum to exactly 100, by largest remainder. */
export const largestRemainderPercents = (values: readonly number[]) => {
	const total = values.reduce((sum, value) => sum + value, 0);
	if (total <= 0) {
		return values.map(() => 0);
	}
	const exact = values.map((value) => (value / total) * 100);
	const floors = exact.map(Math.floor);
	const leftover = 100 - floors.reduce((sum, value) => sum + value, 0);
	const byRemainder = exact
		.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
	for (const { index } of byRemainder.slice(0, leftover)) {
		floors[index] = (floors[index] ?? 0) + 1;
	}
	return floors;
};

export type ActivityShare = {
	readonly key: string;
	readonly label: string;
	readonly value: number;
	/** `"<1%"` for any share under one percent, otherwise the rounded percentage. */
	readonly share: string;
};

/** Media types with activity, each with its share of all activity. */
export const activityShares = (
	rows: readonly { readonly slug: string; readonly label: string; readonly events: number }[],
): readonly ActivityShare[] => {
	const active = rows.filter(({ events }) => events > 0);
	const total = active.reduce((sum, { events }) => sum + events, 0);
	const percents = largestRemainderPercents(active.map(({ events }) => events));
	return active.map((row, index) => ({
		key: row.slug,
		label: row.label,
		value: row.events,
		share: row.events / total < 0.01 ? "<1%" : `${percents[index] ?? 0}%`,
	}));
};
