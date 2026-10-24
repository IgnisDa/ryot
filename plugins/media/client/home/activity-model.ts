import {
	addCalendarDays,
	calendarDaysBetween,
	startOfCalendarUnit,
	startOfLocalDay,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";

const ACTIVITY_WEEKS = 52;

export type ActivityWindow = {
	/** Last local date shown: today. */
	readonly end: string;
	/** Instant `start` begins in the time zone, inclusive. */
	readonly from: string;
	/** First local date shown, always a Monday. */
	readonly start: string;
	/** Instant the day after `end` begins in the time zone, exclusive. */
	readonly until: string;
};

export const activityWindow = (today: string, timeZone: TimeZone): ActivityWindow => {
	const start = addCalendarDays(startOfCalendarUnit(today, "week"), -(ACTIVITY_WEEKS - 1) * 7);
	return {
		start,
		end: today,
		from: startOfLocalDay(start, timeZone),
		until: startOfLocalDay(addCalendarDays(today, 1), timeZone),
	};
};

export const activityDays = (
	window: ActivityWindow,
	counts: ReadonlyMap<string, number>,
): readonly { readonly date: string; readonly value: number }[] =>
	Array.from({ length: calendarDaysBetween(window.start, window.end) + 1 }, (_, index) => {
		const date = addCalendarDays(window.start, index);
		return { date, value: counts.get(date) ?? 0 };
	});

/**
 * Consecutive active days ending today, or ending yesterday while today has no activity yet.
 */
export const activityStreak = (activeDates: ReadonlySet<string>, today: string) => {
	let date = activeDates.has(today) ? today : addCalendarDays(today, -1);
	let streak = 0;
	while (activeDates.has(date)) {
		streak += 1;
		date = addCalendarDays(date, -1);
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

type ActivityShare = {
	readonly key: string;
	readonly label: string;
	readonly value: number;
	/** `"<1%"` for any share under one percent, otherwise the rounded percentage. */
	readonly share: string;
};

const ACTIVITY_SHARE_LIMIT = 5;

export const activityShares = (
	rows: readonly { readonly slug: string; readonly label: string; readonly events: number }[],
): readonly ActivityShare[] => {
	const active = rows
		.filter(({ events }) => events > 0)
		.sort((left, right) => right.events - left.events);
	const folded =
		active.length <= ACTIVITY_SHARE_LIMIT
			? active
			: [
					...active.slice(0, ACTIVITY_SHARE_LIMIT - 1),
					{
						slug: "other",
						label: "Everything else",
						events: active
							.slice(ACTIVITY_SHARE_LIMIT - 1)
							.reduce((sum, { events }) => sum + events, 0),
					},
				];
	const total = folded.reduce((sum, { events }) => sum + events, 0);
	const percents = largestRemainderPercents(folded.map(({ events }) => events));
	return folded.map((row, index) => ({
		key: row.slug,
		label: row.label,
		value: row.events,
		share: row.events / total < 0.01 ? "<1%" : `${percents[index] ?? 0}%`,
	}));
};
