import type { HomePersonalBest, HomeTemplate, MuscleActivity } from "../../shared/home-recipes";
import type { WorkoutExerciseTargets, WorkoutSummary } from "../../shared/workout-list-recipes";
import type { ActiveEditorDraft } from "../exercise/active-draft";
import { describeAgo, personalBestTitles } from "../exercise/details-model";
import { DAY_MS, formatValue, formatDay } from "../measurements/model";
import { countMuscleSets } from "../workout/details-model";
import { formatSetMain, parseDate } from "../workout/format";
import { buildHeatmap, dateKey, durationOf, plural, weekKey, yearUnless } from "../workouts/model";

const WEEKS_SHOWN = 8;
const TEMPLATE_CHIPS = 3;
export const RECENT_DAYS = 30;

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const dayNumber = (key: string) => Date.parse(`${key}T00:00:00.000Z`) / DAY_MS;

export const daysSince = (iso: string, now: Date, timeZone: string) => {
	const date = parseDate(iso);
	return date === null
		? null
		: Math.max(0, dayNumber(dateKey(now, timeZone)) - dayNumber(dateKey(date, timeZone)));
};

export const formatHomeDate = (now: Date, timeZone: string) => {
	const part = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(now);
	return `${part({ weekday: "long" })}, ${part({ month: "long", day: "numeric" })}`;
};

export const lastWorkoutPhrase = (startedAt: string | null, now: Date, timeZone: string) => {
	const days = startedAt === null ? null : daysSince(startedAt, now, timeZone);
	return days === null ? null : `last workout ${describeAgo(days)}`;
};

export const buildWeekProgress = (input: {
	readonly now: Date;
	readonly timeZone: string;
	readonly summary: WorkoutSummary;
	readonly goal: number | undefined;
}) => {
	const { now, goal, summary, timeZone } = input;
	const { weeks, streak } = buildHeatmap(summary, now, timeZone);
	const counts = new Map<string, number>();
	for (const day of summary.days) {
		const key = weekKey(new Date(day.at), timeZone);
		counts.set(key, (counts.get(key) ?? 0) + day.workouts);
	}
	const today = dateKey(now, timeZone);
	const current = weeks.at(-1);
	const recent = weeks.slice(-WEEKS_SHOWN - 1, -1).map(({ key }) => {
		const count = counts.get(key) ?? 0;
		return { key, count, metGoal: goal !== undefined && count >= goal };
	});
	return {
		streak,
		recent,
		goalMet: recent.filter(({ metGoal }) => metGoal).length,
		done: current === undefined ? 0 : (counts.get(current.key) ?? 0),
		peak: Math.max(goal ?? 0, 1, ...recent.map(({ count }) => count)),
		days: (current?.cells ?? []).map(({ key, level }, index) => ({
			key,
			isToday: key === today,
			trained: level !== null && level > 0,
			label: key === today ? "Today" : (weekdayLabels[index] ?? ""),
		})),
	};
};

export const muscleBands = ["cold", "stale", "fresh", "recent"] as const;

export type MuscleBand = (typeof muscleBands)[number];

const bandOf = (days: number | null): MuscleBand => {
	if (days === null || days >= 14) {
		return "cold";
	}
	if (days >= 6) {
		return "stale";
	}
	return days >= 3 ? "fresh" : "recent";
};

export const buildMuscleTiles = (
	activity: readonly MuscleActivity[],
	now: Date,
	timeZone: string,
) =>
	activity.map(({ name, weeklySets, lastTrainedAt }) => {
		const days = lastTrainedAt === null ? null : daysSince(lastTrainedAt, now, timeZone);
		return {
			name,
			band: bandOf(days),
			days: days === null ? "Never" : `${days}d`,
			sets: weeklySets === 0 ? "No sets this week" : plural(weeklySets, "set"),
		};
	});

export const buildTemplateCards = (input: {
	readonly now: Date;
	readonly timeZone: string;
	readonly templates: readonly HomeTemplate[];
	readonly targets: readonly WorkoutExerciseTargets[];
}) => {
	const targets = new Map(input.targets.map(({ id, targets: items }) => [id, items]));
	return input.templates.map((template) => {
		const startedAt = template.lastWorkout?.startedAt ?? null;
		const days = startedAt === null ? null : daysSince(startedAt, input.now, input.timeZone);
		const muscles = countMuscleSets(
			template.exerciseIds.map((id) => ({ sets: 1, targets: targets.get(id) ?? [] })),
		).map(({ name }) => name);
		const took =
			template.lastWorkout === null ? undefined : durationOf(template.lastWorkout)?.value;
		return {
			id: template.id,
			name: template.name,
			chips: muscles.slice(0, TEMPLATE_CHIPS),
			moreChips: Math.max(0, muscles.length - TEMPLATE_CHIPS),
			last: days === null ? "Never done" : describeAgo(days).replace(/^\w/, (c) => c.toUpperCase()),
			meta: [
				plural(template.exerciseCount, "exercise"),
				took === undefined ? null : `last took ${took}`,
			]
				.filter((part) => part !== null)
				.join(" · "),
		};
	});
};

export const buildPersonalBests = (input: {
	readonly now: Date;
	readonly imperial: boolean;
	readonly timeZone: string;
	readonly items: readonly HomePersonalBest[];
}) => {
	const { now, imperial, timeZone } = input;
	const currentYear = dateKey(now, timeZone).slice(0, 4);
	return input.items.map((item) => {
		const occurred = new Date(item.occurredAt);
		const sameYear = dateKey(occurred, timeZone).startsWith(currentYear);
		return {
			id: item.id,
			name: item.exerciseName,
			exerciseId: item.exerciseId,
			value: formatSetMain(item.exerciseKind, item, imperial),
			badge: item.personalBests.map((type) => personalBestTitles[type]).join(", "),
			when: new Intl.DateTimeFormat("en-US", {
				timeZone,
				day: "numeric",
				month: "short",
				weekday: "short",
				...yearUnless(sameYear),
			}).format(occurred),
		};
	});
};

export const draftBanner = (draft: ActiveEditorDraft, now: Date, timeZone: string) => {
	const sets = `${draft.confirmedSets} of ${draft.totalSets} sets confirmed`;
	const started = parseDate(draft.startedAt ?? null);
	if (draft.mode.kind === "live") {
		const minutes =
			started === null
				? null
				: Math.max(0, Math.floor((now.getTime() - started.getTime()) / 60_000));
		return {
			title: "Workout in progress",
			resumeLabel: "Resume workout",
			detail: [
				started === null
					? null
					: `Started ${new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(started)}`,
				minutes === null ? null : `${minutes} min elapsed`,
				sets,
			]
				.filter((part) => part !== null)
				.join(" · "),
		};
	}
	return {
		resumeLabel: "Resume editing",
		detail: plural(draft.totalSets, "set"),
		title: draft.mode.kind === "historical" ? "Editing workout" : "Editing template",
	};
};

export const setupSteps = (input: {
	readonly goalSet: boolean;
	readonly hasTemplate: boolean;
	readonly hasMetric: boolean;
}) => [
	{
		key: "goal",
		done: input.goalSet,
		action: "Choose goal",
		title: "Set a weekly goal",
		hint: "How many workouts you aim for each week",
	},
	{
		done: false,
		key: "workout",
		action: "Start workout",
		title: "Log your first workout",
		hint: "Start empty, or import past sessions",
	},
	{
		key: "template",
		action: "New template",
		done: input.hasTemplate,
		title: "Create a template",
		hint: "Save a routine you can start in one tap",
	},
	{
		key: "metric",
		action: "Add metric",
		done: input.hasMetric,
		title: "Track a measurement",
		hint: "Weight, body fat, or any metric you choose",
	},
];

export const loggedPhrase = (latestAt: string | null, now: Date, timeZone: string) => {
	if (latestAt === null) {
		return "Not logged yet";
	}
	const days = daysSince(latestAt, now, timeZone);
	return days !== null && days <= RECENT_DAYS
		? `Last logged ${describeAgo(days)}`
		: `Last logged ${formatDay(latestAt, timeZone, true)}`;
};

export const measurementValue = (value: number | null, unit: string | null) =>
	value === null ? "—" : formatValue(value, unit);
