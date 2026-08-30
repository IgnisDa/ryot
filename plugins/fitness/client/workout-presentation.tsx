import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import { Badge } from "@ryot-app/client-ui-sdk";

import {
	workoutPresentationRecipe,
	type WorkoutPresentationData,
} from "./workout-presentation-query";

export const loadWorkoutPresentations: EntityPresentationLoader<WorkoutPresentationData> = async ({
	client,
	signal,
	references,
}) => {
	const requestedIds = [...new Set(references.map(({ entityId }) => entityId))];
	const workouts = await client.data.query(workoutPresentationRecipe(requestedIds), { signal });
	return Object.fromEntries(workouts.map((workout) => [workout.id, workout]));
};

const validDate = (value: string | null) => {
	if (value === null) {
		return null;
	}
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
};

const workoutDate = (startedAt: string | null) => {
	const date = validDate(startedAt);
	return date
		? new Intl.DateTimeFormat("en-US", {
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone: "UTC",
			}).format(date)
		: null;
};

const durationParts = (seconds: number) => {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return [hours > 0 ? `${hours}h` : null, minutes > 0 ? `${minutes}m` : null]
		.filter((part) => part !== null)
		.join(" ");
};

const workoutDuration = (startedAt: string | null, endedAt: string | null) => {
	const start = validDate(startedAt);
	const end = validDate(endedAt);
	if (!start || !end || end < start) {
		return null;
	}
	return durationParts((end.getTime() - start.getTime()) / 1000) || "<1m";
};

const measurementUnit = (unitSystem: string | null, metric: string, imperial: string) => {
	if (unitSystem === "metric") {
		return ` ${metric}`;
	}
	if (unitSystem === "imperial") {
		return ` ${imperial}`;
	}
	return "";
};

const setSummary = (set: WorkoutPresentationData["exercises"][number]["sets"][number]) => {
	const weightUnit = measurementUnit(set.unitSystem, "kg", "lb");
	const distanceUnit = measurementUnit(set.unitSystem, "km", "mi");
	const values = [
		set.reps === null ? null : `${set.reps} reps`,
		set.weight === null ? null : `${set.weight}${weightUnit}`,
		set.distance === null ? null : `${set.distance}${distanceUnit}`,
		set.duration === null ? null : durationParts(set.duration) || `${set.duration}s`,
	];
	return values.filter((value) => value !== null).join(" · ");
};

const WorkoutDetails = ({ data }: { readonly data: WorkoutPresentationData }) => {
	const setCount = data.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
	if (setCount === 0) {
		return null;
	}
	return (
		<details className="group min-w-0">
			<summary className="cursor-pointer text-sm font-semibold text-accent-text">
				{data.exercises.length} {data.exercises.length === 1 ? "exercise" : "exercises"} ·{" "}
				{setCount} {setCount === 1 ? "set" : "sets"}
			</summary>
			<ul className="mt-3 grid gap-3 border-t border-border pt-3">
				{data.exercises.map((exercise) => (
					<li key={exercise.id} className="min-w-0">
						<p className="truncate text-sm font-semibold text-text">{exercise.name}</p>
						<ul className="mt-1 flex min-w-0 flex-wrap gap-1.5">
							{exercise.sets.map((set, index) => {
								const summary = setSummary(set);
								return summary ? (
									<li key={`${exercise.id}-${set.setOrder ?? index}`}>
										<Badge variant="key">{summary}</Badge>
									</li>
								) : null;
							})}
						</ul>
					</li>
				))}
			</ul>
		</details>
	);
};

export const WorkoutPresentation = ({
	data,
	layout,
	compact,
	reference,
}: EntityPresentationComponentProps<WorkoutPresentationData> & {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
}) => {
	const date = workoutDate(data.startedAt);
	const duration = workoutDuration(data.startedAt, data.endedAt);
	return (
		<article
			data-layout={layout}
			data-compact={compact}
			data-entity-id={reference.entityId}
			className={`min-w-0 rounded-xl border border-border bg-surface shadow-card ${
				compact ? "p-3" : "p-4"
			}`}
		>
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
				<div className="min-w-0 flex-1">
					<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
						<span className={`${compact ? "text-base" : "text-lg"} font-semibold text-text`}>
							{data.name}
						</span>
					</PluginLink>
					{date && <time className="mt-1 block text-sm text-text-muted">{date}</time>}
				</div>
				{duration && <Badge>{duration}</Badge>}
			</div>
			<div className="mt-3">
				<WorkoutDetails data={data} />
			</div>
		</article>
	);
};

const WorkoutCard = (props: EntityPresentationComponentProps<WorkoutPresentationData>) => {
	const { compact } = useRyotViewport();
	return <WorkoutPresentation {...props} compact={compact} layout="grid" />;
};

const WorkoutRow = (props: EntityPresentationComponentProps<WorkoutPresentationData>) => {
	const { compact } = useRyotViewport();
	return <WorkoutPresentation {...props} compact={compact} layout="list" />;
};

export const workoutCardPresentation = defineEntityPresentation({
	component: WorkoutCard,
	loader: loadWorkoutPresentations,
});

export const workoutRowPresentation = defineEntityPresentation({
	component: WorkoutRow,
	loader: loadWorkoutPresentations,
});
