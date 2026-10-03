import { usePluginLocation, useRyotViewport, PluginPackageId } from "@ryot-app/client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyotQuery,
	type RyotQueryResult,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { exerciseDetailsRecipe, type ExerciseDetails } from "../../shared/exercise-details-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { managedAssetBatch } from "../asset-urls";
import { dedupeWorkoutNotes, type ExerciseRecord } from "./details-model";
import { HistorySection, RecentSessions } from "./history";
import { NotesSection } from "./notes";
import { ExerciseHeader, ExerciseOverview, Instructions } from "./overview";

const exerciseDetailsQuery = createRyotQuery<
	{ readonly entityId: string; readonly timeZone: string },
	ExerciseDetails
>(
	({ input, client }) =>
		client.data.query(
			exerciseDetailsRecipe({
				timeZone: input.timeZone,
				exerciseId: input.entityId,
				reference: client.pluginIdentity(PluginPackageId.make(PLUGIN_PACKAGE_ID)),
			}),
		),
	{ entityInterest: ({ input }) => ({ visible: [], foreground: [input.entityId] }) },
);

export function ExerciseDetailsView(props: {
	readonly now: Date;
	readonly compact: boolean;
	readonly timeZone: string;
	readonly details: ExerciseDetails;
	readonly exercise: ExerciseRecord;
	readonly onNotesChanged: () => void;
}) {
	const { now, compact, details, exercise, timeZone, onNotesChanged } = props;
	const workoutNotes = useMemo(
		() => dedupeWorkoutNotes(details.setNotes, details.workoutNotes),
		[details.setNotes, details.workoutNotes],
	);
	const performed = details.totals.sets > 0;
	const instructions = <Instructions exercise={exercise} />;
	const notes = (
		<NotesSection
			notes={details.notes}
			exerciseId={exercise.id}
			onChanged={onNotesChanged}
			workoutNotes={workoutNotes}
		/>
	);
	return (
		<ManagedAssetProvider assets={managedAssetBatch(exercise.images ?? [])}>
			<div className={clsx("mx-auto flex w-full max-w-6xl flex-col", compact ? "gap-5" : "gap-8")}>
				<ExerciseHeader compact={compact} exercise={exercise} />
				<ExerciseOverview compact={compact} exercise={exercise} />
				{performed ? null : instructions}
				<HistorySection
					now={now}
					compact={compact}
					details={details}
					exercise={exercise}
					timeZone={timeZone}
				/>
				{performed ? (
					<RecentSessions compact={compact} details={details} kind={exercise.kind} />
				) : null}
				{performed ? (
					<div className={clsx("grid gap-5", !compact && "lg:grid-cols-2 lg:items-start")}>
						{instructions}
						{notes}
					</div>
				) : (
					notes
				)}
			</div>
		</ManagedAssetProvider>
	);
}

function ExerciseDetailsBody(props: {
	readonly compact: boolean;
	readonly timeZone: string;
	readonly result: RyotQueryResult<ExerciseDetails>;
}) {
	const { result, compact, timeZone } = props;
	const [now] = useState(() => new Date());
	const details = result.data;
	if (details?.exercise !== undefined && details.exercise !== null) {
		return (
			<ExerciseDetailsView
				now={now}
				compact={compact}
				details={details}
				timeZone={timeZone}
				exercise={details.exercise}
				onNotesChanged={result.refetch}
			/>
		);
	}
	if (result.isError) {
		return (
			<div className="flex flex-col items-start gap-3 font-ui">
				<StatusMessage tone="error">This exercise couldn't be loaded.</StatusMessage>
				<Button variant="secondary" onClick={result.refetch}>
					Try again
				</Button>
			</div>
		);
	}
	return (
		<StatusMessage tone="pending" className="font-ui">
			{details === undefined ? "Loading exercise…" : "This exercise no longer exists."}
		</StatusMessage>
	);
}

function ExerciseDetailsScreen(props: { readonly entityId: string }) {
	const { compact } = useRyotViewport();
	const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
	const result = useRyotQuery(exerciseDetailsQuery, { timeZone, entityId: props.entityId });
	return (
		<PluginScreenFrame hideTitle title={result.data?.exercise?.name ?? null}>
			<ExerciseDetailsBody result={result} compact={compact} timeZone={timeZone} />
		</PluginScreenFrame>
	);
}

export default function ExerciseDetailsPage() {
	const location = usePluginLocation();
	return location.kind === "entity" ? <ExerciseDetailsScreen entityId={location.entityId} /> : null;
}
