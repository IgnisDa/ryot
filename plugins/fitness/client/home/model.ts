import {
	localDateOf,
	type ReportingCalendar,
	startOfCalendarUnit,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Formatters } from "@ryot-app/plugin-client-sdk/react";
import { formatDaysAgo } from "@ryot-app/plugin-ui-sdk/datetime";

import { countMuscleSets } from "../../shared/fitness-metrics";
import type { HomePersonalBest, HomeTemplate, MuscleActivity } from "../../shared/home-recipes";
import type { WorkoutExerciseTargets, WorkoutSummary } from "../../shared/workout-list-recipes";
import type { ActiveEditorDraft } from "../exercise/active-draft";
import { daysSince, personalBestTitle } from "../exercise/details-model";
import { formatDay, formatValue } from "../measurements/model";
import type { FitnessText } from "../messages";
import { formatSetMain, parseDate } from "../workout/format";
import {
	buildHeatmap,
	countLabel,
	describeDuration,
	durationOf,
	yearUnless,
} from "../workouts/model";

const WEEKS_SHOWN = 8;
const TEMPLATE_CHIPS = 3;
export const RECENT_DAYS = 30;

export const formatHomeDate = (formatters: Formatters, now: Date, timeZone: TimeZone) =>
	formatters.dateTime({ timeZone, month: "long", day: "numeric", weekday: "long" }).format(now);

export const lastWorkoutPhrase = (
	formatters: Formatters,
	text: FitnessText,
	startedAt: null | string,
	now: Date,
	timeZone: TimeZone,
) => {
	const days = daysSince(startedAt, now, timeZone);
	return days === null
		? null
		: text("client.home.last-workout", { ago: formatDaysAgo(formatters, days) });
};

export const buildWeekProgress = (
	formatters: Formatters,
	text: FitnessText,
	input: {
		readonly now: Date;
		readonly summary: WorkoutSummary;
		readonly goal: number | undefined;
		readonly calendar: ReportingCalendar;
	},
) => {
	const { now, goal, summary, calendar } = input;
	const { timeZone, weekStart } = calendar;
	const { weeks, streak } = buildHeatmap(formatters, summary, now, calendar);
	const counts = new Map<string, number>();
	for (const day of summary.days) {
		const key = startOfCalendarUnit(localDateOf(day.at, timeZone), "week", weekStart);
		counts.set(key, (counts.get(key) ?? 0) + day.workouts);
	}
	const today = localDateOf(now, timeZone);
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
		days: (current?.cells ?? []).map(({ key, level }) => ({
			key,
			isToday: key === today,
			trained: level !== null && level > 0,
			label:
				key === today
					? text("client.home.today")
					: formatters
							.dateTime({ timeZone: "UTC", weekday: "short" })
							.format(new Date(`${key}T00:00:00.000Z`)),
		})),
	};
};

export const muscleBands = ["cold", "stale", "fresh", "recent"] as const;

export type MuscleBand = (typeof muscleBands)[number];

const bandOf = (days: null | number): MuscleBand => {
	if (days === null || days >= 14) {
		return "cold";
	}
	if (days >= 6) {
		return "stale";
	}
	return days >= 3 ? "fresh" : "recent";
};

export const buildMuscleTiles = (
	text: FitnessText,
	activity: readonly MuscleActivity[],
	now: Date,
	timeZone: TimeZone,
) =>
	activity.map(({ id, name, weeklySets, lastTrainedAt }) => {
		const days = daysSince(lastTrainedAt, now, timeZone);
		return {
			id,
			name,
			band: bandOf(days),
			sets:
				weeklySets === 0 ? text("client.home.muscle-no-sets") : countLabel(text, "set", weeklySets),
			days:
				days === null
					? text("client.home.muscle-never")
					: text("client.home.muscle-days", { days }),
		};
	});

export const buildTemplateCards = (
	formatters: Formatters,
	text: FitnessText,
	input: {
		readonly now: Date;
		readonly timeZone: TimeZone;
		readonly templates: readonly HomeTemplate[];
		readonly targets: readonly WorkoutExerciseTargets[];
	},
) => {
	const targets = new Map(input.targets.map(({ id, targets: items }) => [id, items]));
	return input.templates.map((template) => {
		const startedAt = template.lastWorkout?.startedAt ?? null;
		const days = daysSince(startedAt, input.now, input.timeZone);
		const muscles = countMuscleSets(
			template.exerciseIds.map((id) => ({ sets: 1, targets: targets.get(id) ?? [] })),
		).map(({ name }) => name);
		const took = template.lastWorkout === null ? null : durationOf(template.lastWorkout);
		return {
			id: template.id,
			name: template.name,
			chips: muscles.slice(0, TEMPLATE_CHIPS),
			moreChips: Math.max(0, muscles.length - TEMPLATE_CHIPS),
			last:
				days === null
					? text("client.home.never-done")
					: text("client.home.last-done", { ago: formatDaysAgo(formatters, days) }),
			meta: [
				countLabel(text, "exercise", template.exerciseCount),
				took === null
					? null
					: text("client.home.last-took", { took: describeDuration(formatters, text, took).value }),
			]
				.filter((part) => part !== null)
				.join(" · "),
		};
	});
};

export const buildPersonalBests = (
	formatters: Formatters,
	text: FitnessText,
	input: {
		readonly now: Date;
		readonly imperial: boolean;
		readonly timeZone: TimeZone;
		readonly items: readonly HomePersonalBest[];
	},
) => {
	const { now, imperial, timeZone } = input;
	const currentYear = localDateOf(now, timeZone).slice(0, 4);
	return input.items.map((item) => {
		const occurred = new Date(item.occurredAt);
		const sameYear = localDateOf(occurred, timeZone).startsWith(currentYear);
		return {
			id: item.id,
			name: item.exerciseName,
			exerciseId: item.exerciseId,
			value: formatSetMain(formatters, text, item.exerciseKind, item, imperial),
			badge: formatters
				.list({ type: "unit", style: "long" })
				.format(item.personalBests.map((type) => personalBestTitle(text, type))),
			when: formatters
				.dateTime({
					timeZone,
					day: "numeric",
					month: "short",
					weekday: "short",
					...yearUnless(sameYear),
				})
				.format(occurred),
		};
	});
};

export const draftBanner = (
	formatters: Formatters,
	text: FitnessText,
	draft: ActiveEditorDraft,
	now: Date,
	timeZone: TimeZone,
) => {
	const sets = text("client.home.draft-sets-confirmed", {
		total: draft.totalSets,
		confirmed: draft.confirmedSets,
	});
	const started = parseDate(draft.startedAt ?? null);
	if (draft.mode.kind === "live") {
		const minutes =
			started === null
				? null
				: Math.max(0, Math.floor((now.getTime() - started.getTime()) / 60_000));
		return {
			title: text("client.home.draft-live-title"),
			resumeLabel: text("client.home.draft-live-resume"),
			detail: [
				started === null
					? null
					: text("client.home.draft-started", {
							time: formatters
								.dateTime({ timeZone, hour: "numeric", minute: "2-digit" })
								.format(started),
						}),
				minutes === null ? null : text("client.home.draft-elapsed", { minutes }),
				sets,
			]
				.filter((part) => part !== null)
				.join(" · "),
		};
	}
	return {
		detail: countLabel(text, "set", draft.totalSets),
		resumeLabel: text("client.home.draft-edit-resume"),
		title:
			draft.mode.kind === "historical"
				? text("client.home.draft-editing-workout")
				: text("client.home.draft-editing-template"),
	};
};

export const setupSteps = (
	text: FitnessText,
	input: { readonly goalSet: boolean; readonly hasMetric: boolean; readonly hasTemplate: boolean },
) => [
	{
		key: "goal",
		done: input.goalSet,
		hint: text("client.home.setup.goal-hint"),
		title: text("client.home.setup.goal-title"),
		action: text("client.home.setup.goal-action"),
	},
	{
		done: false,
		key: "workout",
		action: text("client.workouts.start"),
		hint: text("client.home.setup.workout-hint"),
		title: text("client.home.setup.workout-title"),
	},
	{
		key: "template",
		done: input.hasTemplate,
		hint: text("client.home.setup.template-hint"),
		title: text("client.home.setup.template-title"),
		action: text("client.home.setup.template-action"),
	},
	{
		key: "metric",
		done: input.hasMetric,
		hint: text("client.home.setup.metric-hint"),
		title: text("client.home.setup.metric-title"),
		action: text("client.measurements.add-metric"),
	},
];

export const loggedPhrase = (
	formatters: Formatters,
	text: FitnessText,
	latestAt: null | string,
	now: Date,
	timeZone: TimeZone,
) => {
	if (latestAt === null) {
		return text("client.home.not-logged");
	}
	const days = daysSince(latestAt, now, timeZone);
	return text("client.home.last-logged", {
		when:
			days !== null && days <= RECENT_DAYS
				? formatDaysAgo(formatters, days)
				: formatDay(formatters, latestAt, timeZone, true),
	});
};

export const measurementValue = (
	formatters: Formatters,
	text: FitnessText,
	value: null | number,
	unit: null | string,
) => (value === null ? "—" : formatValue(formatters, text, value, unit));
