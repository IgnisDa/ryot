import { usePluginLocation, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	useRyotQuery,
	type RyotQueryResult,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useMemo } from "react";

import type { WorkoutDetails } from "../../shared/workout-details-recipes";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import { managedAssetBatch } from "../asset-urls";
import { DisplayPreferences } from "../display-preferences";
import { WorkoutMediaViewer } from "../media-viewer";
import {
	buildExerciseGroups,
	buildTimeline,
	countEquipment,
	cardMuscleSources,
	countMuscleSets,
	summarizeWorkout,
} from "./details-model";
import { ExerciseGroups } from "./exercise-card";
import { WorkoutComment, WorkoutHeader, WorkoutSession, WorkoutSummaryRow } from "./overview";
import { workoutDetailsQuery } from "./queries";

export function WorkoutDetailsView(props: {
	readonly settings: Pick<WorkoutPreferenceSettings, "unitSystem" | "energyUnit">;
	readonly proAvailable: boolean;
	readonly compact: boolean;
	readonly workout: WorkoutDetails;
}) {
	const { compact, workout } = props;
	const imperial = props.settings.unitSystem === "imperial";
	const view = useMemo(() => {
		const groups = buildExerciseGroups(workout);
		const summary = summarizeWorkout(workout, groups);
		return {
			groups,
			summary,
			equipment: countEquipment(groups),
			muscles: countMuscleSets(cardMuscleSources(groups)),
			timeline: buildTimeline(workout, groups, summary.restSeconds),
		};
	}, [workout]);
	return (
		<ManagedAssetProvider
			assets={managedAssetBatch(workout.exercises.items.map((exercise) => exercise.images?.[0]))}
		>
			<div className={clsx("mx-auto flex w-full max-w-6xl flex-col", compact ? "gap-5" : "gap-7")}>
				<WorkoutHeader compact={compact} workout={workout} proAvailable={props.proAvailable} />
				<WorkoutSummaryRow
					compact={compact}
					workout={workout}
					imperial={imperial}
					summary={view.summary}
					energyUnit={props.settings.energyUnit}
				/>
				<WorkoutSession
					compact={compact}
					muscles={view.muscles}
					timeline={view.timeline}
					equipment={view.equipment}
				/>
				<WorkoutComment comment={workout.comment} />
				<WorkoutMediaViewer
					label={workout.name}
					images={workout.images ?? []}
					videos={workout.videos ?? []}
				/>
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
						imperial={imperial}
						groups={view.groups}
						workoutStartedAt={workout.startedAt}
					/>
				</section>
			</div>
		</ManagedAssetProvider>
	);
}

function WorkoutDetailsBody(props: {
	readonly settings: Pick<WorkoutPreferenceSettings, "unitSystem" | "energyUnit">;
	readonly proAvailable: boolean;
	readonly compact: boolean;
	readonly result: RyotQueryResult<WorkoutDetails | null>;
}) {
	const { result, compact } = props;
	const workout = result.data;
	if (workout !== undefined && workout !== null) {
		return (
			<WorkoutDetailsView
				compact={compact}
				workout={workout}
				settings={props.settings}
				proAvailable={props.proAvailable}
			/>
		);
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
			<DisplayPreferences>
				{(context) => (
					<WorkoutDetailsBody
						result={result}
						compact={compact}
						settings={context.settings}
						proAvailable={context.proAvailable}
					/>
				)}
			</DisplayPreferences>
		</PluginScreenFrame>
	);
}

export default function WorkoutDetailsPage() {
	const location = usePluginLocation();
	return location.kind === "entity" ? <WorkoutDetailsScreen entityId={location.entityId} /> : null;
}
