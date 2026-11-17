import { DateTime } from "@ryot-app/plugin-client-sdk/effect";
import {
	addCalendarDays,
	calendarPeriod,
	localDateOf,
	type ReportingCalendar,
	startOfCalendarUnit,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";

import { elapsedWorkoutSeconds } from "../../shared/fitness-metrics";
import type {
	WorkoutComparison,
	WorkoutListItem,
	WorkoutPeriodTotals,
	WorkoutSummary,
} from "../../shared/workout-list-recipes";
import { kilogramsToPounds } from "../../shared/workout-units";
import type { FitnessText } from "../messages";
import { formatNumber, formatSetMain, formatWeightedVolume, parseDate } from "../workout/format";

const CARD_EXERCISES = 3;
const CARD_MUSCLES = 3;

export const HEATMAP_WEEKS = 26;

export const periodOptions = [
	{ days: 7, key: "7D" },
	{ days: 30, key: "1M" },
	{ days: 90, key: "3M" },
	{ key: "1Y", days: 365 },
] as const;

export type PeriodKey = (typeof periodOptions)[number]["key"];

const periodOf = (key: PeriodKey) =>
	periodOptions.find((option) => option.key === key) ?? periodOptions[1];

export const summaryWindows = (period: PeriodKey, now: Date, timeZone: TimeZone) => {
	const today = localDateOf(now, timeZone);
	const days = periodOf(period).days;
	const window = (endOffset: number, length: number) =>
		calendarPeriod(
			addCalendarDays(today, endOffset - length + 1),
			addCalendarDays(today, endOffset),
			timeZone,
		);
	return {
		current: window(0, days),
		previous: window(-days, days),
		days: window(0, HEATMAP_WEEKS * 7 + 2),
	};
};

const keyDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

const keyFormat = (formatters: Formatters, options: Intl.DateTimeFormatOptions) =>
	formatters.dateTime({ ...options, timeZone: "UTC" });

export const yearUnless = (sameYear: boolean) => (sameYear ? {} : { year: "numeric" as const });

const keyDayFormat = (formatters: Formatters, key: string, currentYear: string) =>
	keyFormat(formatters, {
		day: "numeric",
		month: "short",
		...yearUnless(key.startsWith(currentYear)),
	});

const shortDay = (formatters: Formatters, key: string, currentYear: string) =>
	keyDayFormat(formatters, key, currentYear).format(keyDate(key));

const weekRange = (formatters: Formatters, key: string, currentYear: string) =>
	keyDayFormat(formatters, key, currentYear).formatRange(
		keyDate(key),
		keyDate(addCalendarDays(key, 6)),
	);

export const formatVolume = (
	formatters: Formatters,
	text: FitnessText,
	kilograms: number,
	imperial: boolean,
	compact = false,
) => {
	const value = imperial ? kilogramsToPounds(kilograms) : kilograms;
	return formatWeightedVolume(
		formatters,
		text,
		value,
		imperial,
		compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 0 },
	);
};

export const cardVolume = (
	formatters: Formatters,
	text: FitnessText,
	card: { readonly imperial: boolean; readonly volume: null | number },
) => (card.volume === null ? null : formatVolume(formatters, text, card.volume, card.imperial));

export const countLabel = (
	text: FitnessText,
	noun: "pr" | "set" | "award" | "workout" | "exercise",
	count: number,
) => text("common.count", { noun, count });

export const percentChange = (current: null | number, previous: null | number | undefined) =>
	current === null || previous === null || previous === undefined || previous === 0
		? null
		: Math.round(((current - previous) / previous) * 100);

export type Tone = "up" | "down" | "muted" | "record";

export const changeTone = (change: null | number): Tone => {
	if (change === null || change === 0) {
		return "muted";
	}
	return change > 0 ? "up" : "down";
};

export const formatChange = (formatters: Formatters, change: number) => {
	const percent = formatters.number({ style: "percent" });
	if (change === 0) {
		return `±${percent.format(0)}`;
	}
	return `${change > 0 ? "▲" : "▼"} ${percent.format(Math.abs(change) / 100)}`;
};

type ListSet = WorkoutListItem["sets"][number];

const setRank = (set: ListSet) => [
	set.oneRm ?? -1,
	set.weight ?? -1,
	set.distance ?? -1,
	set.duration ?? -1,
	set.reps ?? -1,
];

const outranks = (left: ListSet, right: ListSet) => {
	const leftRank = setRank(left);
	const rightRank = setRank(right);
	const index = leftRank.findIndex((value, position) => value !== rightRank[position]);
	return index !== -1 && (leftRank[index] ?? -1) > (rightRank[index] ?? -1);
};

const exerciseGroups = (sets: readonly ListSet[]) => {
	const groups = new Map<
		string,
		{ readonly key: string; readonly first: ListSet; readonly sets: ListSet[] }
	>();
	for (const set of sets) {
		const key = `${set.exerciseOrder}:${set.exerciseId}`;
		const group = groups.get(key);
		if (group === undefined) {
			groups.set(key, { key, first: set, sets: [set] });
		} else {
			group.sets.push(set);
		}
	}
	return [...groups.values()];
};

type Comparison =
	| { readonly kind: "none" }
	| {
			readonly day: null | string;
			readonly change: null | number;
			readonly templateName: null | string;
			readonly kind: "repeated" | "template";
	  };

export const comparisonLabel = (text: FitnessText, comparison: Comparison) => {
	if (comparison.kind === "none") {
		return null;
	}
	if (comparison.kind === "repeated") {
		return comparison.day === null
			? text("client.workouts.repeated")
			: text("client.workouts.repeated-from", { day: comparison.day });
	}
	const name = comparison.templateName ?? "";
	return comparison.day === null
		? text("client.workouts.template-first", { name })
		: text("client.workouts.template-last", { name, day: comparison.day });
};

const comparisonFor = (
	formatters: Formatters,
	item: WorkoutListItem,
	comparisons: ReadonlyMap<string, WorkoutComparison>,
	currentYear: string,
	timeZone: TimeZone,
): Comparison => {
	const id = item.repeatedFromId ?? item.previousTemplateWorkoutId;
	const previous = id === null ? undefined : comparisons.get(id);
	const previousDate = parseDate(previous?.startedAt ?? null);
	const day =
		previousDate === null
			? null
			: shortDay(formatters, localDateOf(previousDate, timeZone), currentYear);
	const change = percentChange(item.volume, previous?.volume);
	if (item.repeatedFromId !== null) {
		return { day, change, kind: "repeated", templateName: null };
	}
	if (item.template !== null) {
		return { day, change, kind: "template", templateName: item.template.name };
	}
	return { kind: "none" };
};

export type CardDuration = { readonly seconds: number; readonly kind: "active" | "elapsed" };

export const durationOf = (
	item: Pick<WorkoutListItem, "endedAt" | "startedAt" | "activeDuration">,
): null | CardDuration => {
	if (item.activeDuration !== null) {
		return { kind: "active", seconds: item.activeDuration };
	}
	const elapsed = elapsedWorkoutSeconds(item.startedAt, item.endedAt);
	return elapsed === null ? null : { kind: "elapsed", seconds: elapsed };
};

export const describeDuration = (
	formatters: Formatters,
	text: FitnessText,
	duration: CardDuration,
) => ({
	value: formatDuration(formatters, duration.seconds),
	label: text(duration.kind === "active" ? "property.duration" : "client.workouts.elapsed"),
});

export type WorkoutCard = ReturnType<typeof buildWorkoutCards>[number];

export const buildWorkoutCards = (
	formatters: Formatters,
	input: {
		readonly now: Date;
		readonly imperial: boolean;
		readonly timeZone: TimeZone;
		readonly items: readonly WorkoutListItem[];
		readonly weekStart: ReportingCalendar["weekStart"];
		readonly comparisons: readonly WorkoutComparison[];
	},
) => {
	const { now, imperial, timeZone, weekStart } = input;
	const currentYear = localDateOf(now, timeZone).slice(0, 4);
	const comparisons = new Map(input.comparisons.map((comparison) => [comparison.id, comparison]));
	const dayFormat = (sameYear: boolean) =>
		formatters.dateTime({
			timeZone,
			day: "numeric",
			month: "short",
			weekday: "short",
			...yearUnless(sameYear),
		});
	const currentYearDay = dayFormat(true);
	const otherYearDay = dayFormat(false);
	const timeFormat = formatters.dateTime({ timeZone, hour: "numeric", minute: "2-digit" });
	const weekdayFormat = formatters.dateTime({ timeZone, weekday: "short" });
	const startFields = (started: Date | null) => {
		if (started === null) {
			return { day: null, time: null, week: null, weekday: null, dayOfMonth: null };
		}
		const key = localDateOf(started, timeZone);
		return {
			time: timeFormat.format(started),
			dayOfMonth: String(Number(key.slice(8))),
			weekday: weekdayFormat.format(started).toUpperCase(),
			week: startOfCalendarUnit(localDateOf(started, timeZone), "week", weekStart),
			day: (key.startsWith(currentYear) ? currentYearDay : otherYearDay).format(started),
		};
	};
	return input.items.map((item) => {
		const groups = exerciseGroups(item.sets);
		const muscles = item.muscles.items;
		const lines = groups.map(({ key, sets, first }) => {
			const best = sets.reduce((current, set) => (outranks(set, current) ? set : current), first);
			return {
				key,
				best,
				sets: sets.length,
				name: first.exerciseName,
				record: sets.some((set) => (set.personalBests?.length ?? 0) > 0),
			};
		});
		return {
			lines,
			imperial,
			name: item.name,
			id: item.entityId,
			sets: item.setCount,
			volume: item.volume,
			duration: durationOf(item),
			exercises: item.exerciseCount,
			personalBests: item.personalBests,
			top: lines.slice(0, CARD_EXERCISES),
			moreMuscles: Math.max(0, item.muscleCount - CARD_MUSCLES),
			moreExercises: Math.max(0, item.exerciseCount - CARD_EXERCISES),
			muscles: muscles.slice(0, CARD_MUSCLES).map(({ name }) => name),
			comparison: comparisonFor(formatters, item, comparisons, currentYear, timeZone),
			...startFields(parseDate(item.startedAt)),
		};
	});
};

export const formatTotals = (
	formatters: Formatters,
	text: FitnessText,
	totals: undefined | WorkoutPeriodTotals,
	imperial: boolean,
) =>
	totals === undefined
		? null
		: [
				countLabel(text, "workout", totals.workouts),
				totals.activeDuration === null
					? text("client.workouts.active-unknown")
					: text("client.workouts.active", {
							duration: formatDuration(formatters, totals.activeDuration),
						}),
				totals.volume > 0 ? formatVolume(formatters, text, totals.volume, imperial, true) : null,
				totals.personalBests > 0 ? countLabel(text, "award", totals.personalBests) : null,
			]
				.filter((part) => part !== null)
				.join(" · ");

export type WeekSection = ReturnType<typeof groupByWeek>[number];

export const groupByWeek = (
	formatters: Formatters,
	text: FitnessText,
	input: {
		readonly now: Date;
		readonly imperial: boolean;
		readonly timeZone: TimeZone;
		readonly cards: readonly WorkoutCard[];
		readonly totals: readonly WorkoutPeriodTotals[];
		readonly weekStart: ReportingCalendar["weekStart"];
	},
) => {
	const { now, imperial, timeZone, weekStart } = input;
	const current = startOfCalendarUnit(localDateOf(now, timeZone), "week", weekStart);
	const currentYear = current.slice(0, 4);
	const totals = new Map(input.totals.map((item) => [localDateOf(item.at, timeZone), item]));
	const sections: { key: string; cards: WorkoutCard[] }[] = [];
	for (const card of input.cards) {
		const key = card.week ?? "";
		const last = sections.at(-1);
		if (last?.key === key) {
			last.cards.push(card);
		} else {
			sections.push({ key, cards: [card] });
		}
	}
	return sections.map(({ key, cards }) => {
		const range = key === "" ? null : weekRange(formatters, key, currentYear);
		let title = range ?? text("client.workouts.undated");
		if (key === current) {
			title = text("client.workouts.this-week");
		} else if (key === addCalendarDays(current, -7)) {
			title = text("client.workouts.last-week");
		}
		return {
			key,
			cards,
			title,
			range: title === range ? null : range,
			totals: formatTotals(formatters, text, totals.get(key), imperial),
		};
	});
};

export const weeksWindow = (cards: readonly WorkoutCard[]) => {
	const keys = cards.flatMap(({ week }) => (week === null ? [] : [week])).sort();
	const first = keys.at(0);
	const last = keys.at(-1);
	return first === undefined || last === undefined
		? null
		: {
				endAt: DateTime.formatIso(DateTime.makeUnsafe(addCalendarDays(last, 8))),
				startAt: DateTime.formatIso(DateTime.makeUnsafe(addCalendarDays(first, -1))),
			};
};

const activeDurationDetail = (
	formatters: Formatters,
	text: FitnessText,
	current: WorkoutSummary["current"],
) => {
	if (current.timedWorkouts === 0 || current.activeDuration === null) {
		return text("client.workouts.summary.no-timed");
	}
	const average = formatDuration(formatters, current.activeDuration / current.timedWorkouts);
	return current.timedWorkouts < current.workouts
		? text("client.workouts.summary.average-partial", {
				average,
				workouts: current.workouts,
				timed: current.timedWorkouts,
			})
		: text("client.workouts.summary.average", { average });
};

export const buildSummaryTiles = (
	formatters: Formatters,
	text: FitnessText,
	summary: WorkoutSummary,
	period: PeriodKey,
	imperial: boolean,
): readonly {
	readonly tone: Tone;
	readonly label: string;
	readonly value: string;
	readonly detail: string;
}[] => {
	const { current, previous } = summary;
	const volume = current.volume;
	const awards = current.personalBests;
	const latestRecord = summary.latestRecord;
	const weeks = periodOf(period).days / 7;
	const volumeChange = percentChange(volume, previous.volume);
	const volumeDetail =
		volumeChange === null
			? text("client.workouts.summary.volume-none")
			: text("client.workouts.summary.volume-change", {
					days: periodOf(period).days,
					change: formatChange(formatters, volumeChange),
				});
	const awardDetail =
		latestRecord === null
			? text("client.workouts.summary.awards-none")
			: text("client.workouts.summary.awards-latest", {
					name: latestRecord.exerciseName,
					set: formatSetMain(formatters, text, latestRecord.exerciseKind, latestRecord, imperial),
				});
	return [
		{
			tone: "muted",
			label: text("client.workouts.title"),
			value: formatNumber(formatters, current.workouts),
			detail: text("client.workouts.summary.per-week", {
				count: Math.round((current.workouts / weeks) * 10) / 10,
			}),
		},
		{
			tone: "muted",
			label: text("client.workouts.summary.active-duration"),
			detail: activeDurationDetail(formatters, text, current),
			value:
				current.activeDuration === null
					? text("client.editor.stat.unknown")
					: formatDuration(formatters, current.activeDuration),
		},
		{
			detail: volumeDetail,
			tone: changeTone(volumeChange),
			label: text("property.volume"),
			value: formatVolume(formatters, text, volume, imperial, true),
		},
		{
			detail: awardDetail,
			value: formatNumber(formatters, awards),
			label: text("client.workouts.summary.awards"),
			tone: latestRecord === null ? "muted" : "record",
		},
	];
};

export const buildHeatmap = (
	formatters: Formatters,
	summary: WorkoutSummary,
	now: Date,
	{ timeZone, weekStart }: ReportingCalendar,
) => {
	const days = new Map(summary.days.map((day) => [localDateOf(day.at, timeZone), day]));
	const volumes = [...days.values()]
		.flatMap(({ volume }) => (volume > 0 ? [volume] : []))
		.sort((left, right) => left - right);
	const quartile = (fraction: number) => volumes[Math.floor((volumes.length - 1) * fraction)] ?? 0;
	const thresholds = [quartile(0.25), quartile(0.5), quartile(0.75)];
	const today = localDateOf(now, timeZone);
	const currentWeek = startOfCalendarUnit(localDateOf(now, timeZone), "week", weekStart);
	const weeks = Array.from({ length: HEATMAP_WEEKS }, (_week, index) => {
		const key = addCalendarDays(currentWeek, (index - HEATMAP_WEEKS + 1) * 7);
		const cells = Array.from({ length: 7 }, (_day, offset) => {
			const day = addCalendarDays(key, offset);
			const entry = days.get(day);
			if (day > today) {
				return { key: day, level: null };
			}
			if (entry === undefined || entry.workouts === 0) {
				return { key: day, level: 0 };
			}
			return { key: day, level: 1 + thresholds.filter((value) => entry.volume > value).length };
		});
		return {
			key,
			cells,
			trained: cells.some(({ level }) => level !== null && level > 0),
			month:
				Number(key.slice(8)) <= 7
					? keyFormat(formatters, { month: "short" }).format(keyDate(key))
					: null,
		};
	});
	const completed = weeks.at(-1)?.trained === true ? weeks : weeks.slice(0, -1);
	let streak = 0;
	while (completed.at(-streak - 1)?.trained === true) {
		streak += 1;
	}
	return { weeks, streak };
};
