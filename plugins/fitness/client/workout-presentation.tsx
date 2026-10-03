import { Effect } from "@ryot-app/client-sdk/effect";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import { Badge } from "@ryot-app/client-ui-sdk";
import { isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";

import {
	workoutPresentationRecipe,
	type WorkoutPresentationData,
} from "./workout-presentation-query";
import { formatDuration, formatNumber, parseDate } from "./workout/format";

export const loadWorkoutPresentations: EntityPresentationLoader<WorkoutPresentationData> = ({
	client,
	references,
}) => {
	const requestedIds = [...new Set(references.map(({ entityId }) => entityId))];
	return client.data
		.query(workoutPresentationRecipe(requestedIds))
		.pipe(
			Effect.map((workouts) =>
				Object.fromEntries(workouts.map((workout) => [workout.id, workout])),
			),
		);
};

const workoutDate = (startedAt: string | null) => {
	const date = parseDate(startedAt);
	return date
		? new Intl.DateTimeFormat("en-US", {
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone: "UTC",
			}).format(date)
		: null;
};

const workoutDuration = (startedAt: string | null, endedAt: string | null) => {
	const start = parseDate(startedAt);
	const end = parseDate(endedAt);
	if (!start || !end || end < start) {
		return null;
	}
	return formatDuration((end.getTime() - start.getTime()) / 1000);
};

const setSummary = (set: WorkoutPresentationData["exercises"][number]["sets"][number]) =>
	[
		set.reps === null ? null : `${formatNumber(set.reps)} reps`,
		set.weight === null ? null : `${formatNumber(set.weight)} kg`,
		set.distance === null ? null : `${formatNumber(set.distance)} km`,
		set.duration === null ? null : formatDuration(set.duration),
	]
		.filter((value) => value !== null)
		.join(" · ");

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
					<li className="min-w-0" key={`${exercise.order}:${exercise.id}`}>
						<p className="truncate text-sm font-semibold text-text">{exercise.name}</p>
						{exercise.notes.length > 0 && (
							<p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">
								{exercise.notes.join("\n")}
							</p>
						)}
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
			className={`min-w-0 border-b border-border ${compact ? "py-3" : "py-4"}`}
		>
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
				<div className="min-w-0 flex-1">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
							<span className={`${compact ? "text-base" : "text-lg"} font-semibold text-text`}>
								{data.name}
							</span>
						</PluginLink>
						{isTitleProvisional(reference) && <SyncPip reason="translating" />}
					</span>
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
	return <WorkoutPresentation {...props} layout="grid" compact={compact} />;
};

const WorkoutRow = (props: EntityPresentationComponentProps<WorkoutPresentationData>) => {
	const { compact } = useRyotViewport();
	return <WorkoutPresentation {...props} layout="list" compact={compact} />;
};

export const workoutCardPresentation = defineEntityPresentation({
	component: WorkoutCard,
	loader: loadWorkoutPresentations,
});

export const workoutRowPresentation = defineEntityPresentation({
	component: WorkoutRow,
	loader: loadWorkoutPresentations,
});
