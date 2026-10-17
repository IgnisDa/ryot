import type {
	WorkoutComparison,
	WorkoutExerciseTargets,
	WorkoutListItem,
	WorkoutPeriodTotals,
	WorkoutSummary,
} from "../../shared/workout-list-recipes";
import { kilogramsToPounds } from "../../shared/workout-units";
import { countMuscleSets } from "../workout/details-model";
import { formatDuration, formatNumber, formatSetMain, parseDate } from "../workout/format";

const DAY_MS = 86_400_000;
const CARD_EXERCISES = 3;
const CARD_MUSCLES = 3;

export const HEATMAP_WEEKS = 26;

export const periodOptions = [
	{ days: 7, key: "7D", label: "Last 7 days" },
	{ days: 30, key: "1M", label: "Last 30 days" },
	{ days: 90, key: "3M", label: "Last 90 days" },
	{ key: "1Y", days: 365, label: "Last 12 months" },
] as const;

export type PeriodKey = (typeof periodOptions)[number]["key"];

const periodOf = (key: PeriodKey) =>
	periodOptions.find((option) => option.key === key) ?? periodOptions[1];

const iso = (time: number) => new Date(time).toISOString();

export const summaryWindows = (period: PeriodKey, now: Date) => {
	const end = now.getTime();
	const span = periodOf(period).days * DAY_MS;
	return {
		current: { endAt: iso(end), startAt: iso(end - span) },
		previous: { endAt: iso(end - span), startAt: iso(end - 2 * span) },
		days: { endAt: iso(end + DAY_MS), startAt: iso(end - (HEATMAP_WEEKS * 7 + 1) * DAY_MS) },
	};
};

export const dateKey = (date: Date, timeZone: string) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		day: "2-digit",
		year: "numeric",
		month: "2-digit",
	}).format(date);

const keyDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

const shiftKey = (key: string, days: number) =>
	iso(keyDate(key).getTime() + days * DAY_MS).slice(0, 10);

export const weekKey = (date: Date, timeZone: string) => {
	const key = dateKey(date, timeZone);
	return shiftKey(key, -((keyDate(key).getUTCDay() + 6) % 7));
};

const keyFormat = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });

export const yearUnless = (sameYear: boolean) => (sameYear ? {} : { year: "numeric" as const });

const keyDayFormat = (key: string, currentYear: string) =>
	keyFormat({ day: "numeric", month: "short", ...yearUnless(key.startsWith(currentYear)) });

const shortDay = (key: string, currentYear: string) =>
	keyDayFormat(key, currentYear).format(keyDate(key));

const weekRange = (key: string, currentYear: string) =>
	keyDayFormat(key, currentYear).formatRange(keyDate(key), keyDate(shiftKey(key, 6)));

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

export const formatVolume = (kilograms: number, imperial: boolean, compact = false) => {
	const value = imperial ? kilogramsToPounds(kilograms) : kilograms;
	return `${(compact ? compactNumber : wholeNumber).format(value)} ${imperial ? "lb" : "kg"}`;
};

export const plural = (count: number, noun: string) =>
	`${formatNumber(count)} ${noun}${count === 1 ? "" : "s"}`;

export const percentChange = (current: number | null, previous: number | null | undefined) =>
	current === null || previous === null || previous === undefined || previous === 0
		? null
		: Math.round(((current - previous) / previous) * 100);

export type Tone = "down" | "muted" | "record" | "up";

export const changeTone = (change: number | null): Tone => {
	if (change === null || change === 0) {
		return "muted";
	}
	return change > 0 ? "up" : "down";
};

export const formatChange = (change: number) => {
	if (change === 0) {
		return "±0%";
	}
	return `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%`;
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
			readonly kind: "repeated" | "template";
			readonly label: string;
			readonly change: number | null;
	  };

const comparisonFor = (
	item: WorkoutListItem,
	comparisons: ReadonlyMap<string, WorkoutComparison>,
	currentYear: string,
	timeZone: string,
): Comparison => {
	const id = item.repeatedFromId ?? item.previousTemplateWorkoutId;
	const previous = id === null ? undefined : comparisons.get(id);
	const previousDate = parseDate(previous?.startedAt ?? null);
	const day = previousDate === null ? null : shortDay(dateKey(previousDate, timeZone), currentYear);
	const change = percentChange(item.volume, previous?.volume);
	if (item.repeatedFromId !== null) {
		return {
			change,
			kind: "repeated",
			label: day === null ? "Repeated workout" : `Repeated from ${day}`,
		};
	}
	if (item.template !== null) {
		return {
			change,
			kind: "template",
			label:
				day === null
					? `${item.template.name} · first session`
					: `${item.template.name} · last ${day}`,
		};
	}
	return { kind: "none" };
};

export const durationOf = (
	item: Pick<WorkoutListItem, "activeDuration" | "endedAt" | "startedAt">,
) => {
	if (item.activeDuration !== null) {
		return { label: "Duration", value: formatDuration(item.activeDuration) };
	}
	const start = parseDate(item.startedAt);
	const end = parseDate(item.endedAt);
	return start === null || end === null || end < start
		? null
		: { label: "Elapsed", value: formatDuration((end.getTime() - start.getTime()) / 1000) };
};

export type WorkoutCard = ReturnType<typeof buildWorkoutCards>[number];

export const buildWorkoutCards = (input: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: string;
	readonly items: readonly WorkoutListItem[];
	readonly comparisons: readonly WorkoutComparison[];
	readonly targets: readonly WorkoutExerciseTargets[];
}) => {
	const { now, imperial, timeZone } = input;
	const currentYear = dateKey(now, timeZone).slice(0, 4);
	const comparisons = new Map(input.comparisons.map((comparison) => [comparison.id, comparison]));
	const targets = new Map(input.targets.map(({ id, targets: items }) => [id, items]));
	const dayFormat = (sameYear: boolean) =>
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			day: "numeric",
			month: "short",
			weekday: "short",
			...yearUnless(sameYear),
		});
	const currentYearDay = dayFormat(true);
	const otherYearDay = dayFormat(false);
	const timeFormat = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "numeric",
		minute: "2-digit",
	});
	const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
	const startFields = (started: Date | null) => {
		if (started === null) {
			return { day: null, time: null, week: null, weekday: null, dayOfMonth: null };
		}
		const key = dateKey(started, timeZone);
		return {
			week: weekKey(started, timeZone),
			time: timeFormat.format(started),
			dayOfMonth: String(Number(key.slice(8))),
			weekday: weekdayFormat.format(started).toUpperCase(),
			day: (key.startsWith(currentYear) ? currentYearDay : otherYearDay).format(started),
		};
	};
	return input.items.map((item) => {
		const groups = exerciseGroups(item.sets);
		const muscles = countMuscleSets(
			groups.map(({ sets, first }) => ({
				sets: sets.length,
				targets: targets.get(first.exerciseId) ?? [],
			})),
		);
		const lines = groups.map(({ key, sets, first }) => {
			const best = sets.reduce((current, set) => (outranks(set, current) ? set : current), first);
			return {
				key,
				sets: sets.length,
				name: first.exerciseName,
				best: formatSetMain(best.exerciseKind, best, imperial),
				record: sets.some((set) => (set.personalBests?.length ?? 0) > 0),
			};
		});
		return {
			lines,
			id: item.id,
			name: item.name,
			sets: item.setCount,
			duration: durationOf(item),
			exercises: item.exerciseCount,
			top: lines.slice(0, CARD_EXERCISES),
			personalBests: item.personalBests ?? 0,
			moreMuscles: Math.max(0, muscles.length - CARD_MUSCLES),
			moreExercises: Math.max(0, lines.length - CARD_EXERCISES),
			muscles: muscles.slice(0, CARD_MUSCLES).map(({ name }) => name),
			comparison: comparisonFor(item, comparisons, currentYear, timeZone),
			volume: item.volume === null ? null : formatVolume(item.volume, imperial),
			...startFields(parseDate(item.startedAt)),
		};
	});
};

export const formatTotals = (totals: WorkoutPeriodTotals | undefined, imperial: boolean) =>
	totals === undefined
		? null
		: [
				plural(totals.workouts, "workout"),
				totals.activeDuration > 0 ? formatDuration(totals.activeDuration) : null,
				totals.volume > 0 ? formatVolume(totals.volume, imperial, true) : null,
				totals.personalBests > 0 ? plural(totals.personalBests, "PR") : null,
			]
				.filter((part) => part !== null)
				.join(" · ");

export type WeekSection = ReturnType<typeof groupByWeek>[number];

export const groupByWeek = (input: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: string;
	readonly cards: readonly WorkoutCard[];
	readonly totals: readonly WorkoutPeriodTotals[];
}) => {
	const { now, imperial, timeZone } = input;
	const current = weekKey(now, timeZone);
	const currentYear = current.slice(0, 4);
	const totals = new Map(input.totals.map((item) => [dateKey(new Date(item.at), timeZone), item]));
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
		const range = key === "" ? null : weekRange(key, currentYear);
		let title = range ?? "Undated";
		if (key === current) {
			title = "This week";
		} else if (key === shiftKey(current, -7)) {
			title = "Last week";
		}
		return {
			key,
			cards,
			title,
			range: title === range ? null : range,
			totals: formatTotals(totals.get(key), imperial),
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
				endAt: iso(keyDate(shiftKey(last, 8)).getTime()),
				startAt: iso(keyDate(shiftKey(first, -1)).getTime()),
			};
};

export const buildSummaryTiles = (
	summary: WorkoutSummary,
	period: PeriodKey,
	imperial: boolean,
): readonly {
	readonly tone: Tone;
	readonly label: string;
	readonly value: string;
	readonly detail: string;
}[] => {
	const { current, previous, latestRecord } = summary;
	const weeks = periodOf(period).days / 7;
	const volumeChange = percentChange(current.volume, previous.volume);
	return [
		{
			tone: "muted",
			label: "Workouts",
			value: formatNumber(current.workouts),
			detail: `${formatNumber(Math.round((current.workouts / weeks) * 10) / 10)} per week`,
		},
		{
			tone: "muted",
			label: "Time trained",
			value: formatDuration(current.activeDuration),
			detail:
				current.timedWorkouts === 0
					? "No timed workouts"
					: `avg ${formatDuration(current.activeDuration / current.timedWorkouts)}${current.timedWorkouts < current.workouts ? ` · ${current.timedWorkouts} of ${current.workouts} timed` : ""}`,
		},
		{
			label: "Volume",
			tone: changeTone(volumeChange),
			value: formatVolume(current.volume, imperial, true),
			detail:
				volumeChange === null
					? "Nothing to compare yet"
					: `${formatChange(volumeChange)} vs previous ${periodOf(period).days} days`,
		},
		{
			label: "Personal records",
			value: formatNumber(current.personalBests),
			tone: latestRecord === null ? "muted" : "record",
			detail:
				latestRecord === null
					? "None in this period"
					: `latest: ${latestRecord.exerciseName} ${formatSetMain(latestRecord.exerciseKind, latestRecord, imperial)}`,
		},
	];
};

export const buildHeatmap = (summary: WorkoutSummary, now: Date, timeZone: string) => {
	const days = new Map(summary.days.map((day) => [dateKey(new Date(day.at), timeZone), day]));
	const volumes = [...days.values()]
		.map(({ volume }) => volume)
		.filter((volume) => volume > 0)
		.sort((left, right) => left - right);
	const quartile = (fraction: number) => volumes[Math.floor((volumes.length - 1) * fraction)] ?? 0;
	const thresholds = [quartile(0.25), quartile(0.5), quartile(0.75)];
	const today = dateKey(now, timeZone);
	const currentWeek = weekKey(now, timeZone);
	const weeks = Array.from({ length: HEATMAP_WEEKS }, (_week, index) => {
		const key = shiftKey(currentWeek, (index - HEATMAP_WEEKS + 1) * 7);
		const cells = Array.from({ length: 7 }, (_day, offset) => {
			const day = shiftKey(key, offset);
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
			month: Number(key.slice(8)) <= 7 ? keyFormat({ month: "short" }).format(keyDate(key)) : null,
		};
	});
	const completed = weeks.at(-1)?.trained === true ? weeks : weeks.slice(0, -1);
	let streak = 0;
	while (completed.at(-streak - 1)?.trained === true) {
		streak += 1;
	}
	return { weeks, streak };
};
