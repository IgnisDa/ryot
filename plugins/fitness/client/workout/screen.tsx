import { usePluginLocation, useRyotViewport } from "@ryot-app/client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyotQuery,
	type RyotQueryResult,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useMemo } from "react";

import { workoutDetailsRecipe, type WorkoutDetails } from "../../shared/workout-details-recipes";
import { managedAssetBatch } from "../asset-urls";
import {
	buildExerciseGroups,
	buildTimeline,
	countEquipment,
	countMuscleSets,
	summarizeWorkout,
} from "./details-model";
import { ExerciseGroups } from "./exercise-card";
import { WorkoutComment, WorkoutHeader, WorkoutSession, WorkoutSummaryRow } from "./overview";

const workoutDetailsQuery = createRyotQuery<{ readonly entityId: string }, WorkoutDetails | null>(
	({ input, client }) => client.data.query(workoutDetailsRecipe({ workoutId: input.entityId })),
	{
		entityInterest: ({ data, input }) => ({
			foreground: [input.entityId],
			visible: data?.exercises.items.map(({ id }) => id) ?? [],
		}),
	},
);

export function WorkoutDetailsView(props: {
	readonly compact: boolean;
	readonly workout: WorkoutDetails;
}) {
	const { compact, workout } = props;
	const view = useMemo(() => {
		const groups = buildExerciseGroups(workout);
		const summary = summarizeWorkout(workout, groups);
		return {
			groups,
			summary,
			muscles: countMuscleSets(groups),
			equipment: countEquipment(groups),
			timeline: buildTimeline(workout, groups, summary.restSeconds),
		};
	}, [workout]);
	return (
		<ManagedAssetProvider
			assets={managedAssetBatch(workout.exercises.items.map((exercise) => exercise.images?.[0]))}
		>
			<div className={clsx("mx-auto flex w-full max-w-6xl flex-col", compact ? "gap-5" : "gap-7")}>
				<WorkoutHeader compact={compact} workout={workout} />
				<WorkoutSummaryRow compact={compact} workout={workout} summary={view.summary} />
				<WorkoutSession
					compact={compact}
					muscles={view.muscles}
					timeline={view.timeline}
					equipment={view.equipment}
				/>
				<WorkoutComment comment={workout.comment} />
				<section aria-label="Exercises" className="flex flex-col gap-4">
					<div className="flex items-baseline justify-between font-ui">
						<h2 className="font-display font-semibold text-[22px] text-text">Exercises</h2>
						<span className="text-[14px] text-text-muted">
							{view.summary.exercises} {view.summary.exercises === 1 ? "exercise" : "exercises"} ·{" "}
							{view.summary.sets} {view.summary.sets === 1 ? "set" : "sets"}
						</span>
					</div>
					<ExerciseGroups
						compact={compact}
						groups={view.groups}
						workoutStartedAt={workout.startedAt}
					/>
				</section>
			</div>
		</ManagedAssetProvider>
	);
}

function WorkoutDetailsBody(props: {
	readonly compact: boolean;
	readonly result: RyotQueryResult<WorkoutDetails | null>;
}) {
	const { result, compact } = props;
	const workout = result.data;
	if (workout !== undefined && workout !== null) {
		return <WorkoutDetailsView compact={compact} workout={workout} />;
	}
	if (result.isError) {
		return (
			<div className="flex flex-col items-start gap-3 font-ui">
				<StatusMessage tone="error">This workout couldn't be loaded.</StatusMessage>
				<Button variant="secondary" onClick={result.refetch}>
					Try again
				</Button>
			</div>
		);
	}
	return (
		<StatusMessage tone="pending" className="font-ui">
			{workout === null ? "This workout no longer exists." : "Loading workout…"}
		</StatusMessage>
	);
}

function WorkoutDetailsScreen(props: { readonly entityId: string }) {
	const { compact } = useRyotViewport();
	const result = useRyotQuery(workoutDetailsQuery, { entityId: props.entityId });
	return (
		<PluginScreenFrame hideTitle title={result.data?.name ?? null}>
			<WorkoutDetailsBody result={result} compact={compact} />
		</PluginScreenFrame>
	);
}

export default function WorkoutDetailsPage() {
	const location = usePluginLocation();
	return location.kind === "entity" ? <WorkoutDetailsScreen entityId={location.entityId} /> : null;
}
