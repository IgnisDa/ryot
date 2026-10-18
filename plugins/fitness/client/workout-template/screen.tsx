import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { usePluginLocation, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyot,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, Card, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import { supersetColor } from "../../shared/superset-colors";
import type { WorkoutEditorOccurrence } from "../../shared/workout-editor-draft";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { durationDisplayUnit } from "../../shared/workout-units";
import { AssetArtWell, managedAssetBatch } from "../asset-urls";
import { supersetColorVariable } from "../group-colors";
import { WorkoutMediaViewer } from "../media-viewer";
import { setLabels, setLots } from "../set-lots";
import { workoutEditorContextQuery } from "../workout-editor/context-query";
import {
	editorExercisesQuery,
	loadEditorSource,
	type EditorExercise,
} from "../workout-editor/queries";
import { supersetNames } from "../workout-editor/superset-group";
import { formatClock, formatExerciseMeta, formatSetMain } from "../workout/format";

const templateQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: string }) =>
		loadEditorSource(client, {
			entityId: input,
			kind: "template",
			draftId: `template-detail:${input}`,
		}),
	{ entityWatch: ({ input }) => ({ visible: [], foreground: [input] }) },
);
const number = (value: string | undefined) => (value === undefined ? null : Number(value));

function TemplateDetails(props: { readonly entityId: string }) {
	const client = useRyot();
	const { compact } = useRyotViewport();
	const source = useRyotQuery(templateQuery, props.entityId);
	const context = useRyotQuery(workoutEditorContextQuery, undefined);
	const draft = source.data?.kind === "ready" ? source.data.draft : undefined;
	const exercises = useRyotQuery(editorExercisesQuery, {
		exerciseIds: [...new Set(draft?.occurrences.map(({ exerciseId }) => exerciseId) ?? [])],
	});
	const imperial = context.data?.settings.unitSystem === "imperial";
	const action = (kind: "start" | "edit") =>
		client.navigation.push(
			fitnessRoute(`/templates/${encodeURIComponent(props.entityId)}/${kind}`),
		);
	if (source.isError || context.isError || exercises.isError) {
		return (
			<PluginScreenFrame title="Workout template">
				<StatusMessage tone="error">
					This template or its display preferences could not be loaded. The record may no longer
					exist.
				</StatusMessage>
				<Button
					onClick={() => {
						source.refetch();
						context.refetch();
						exercises.refetch();
					}}
				>
					Retry template
				</Button>
			</PluginScreenFrame>
		);
	}
	if (source.data?.kind === "blocked") {
		return (
			<PluginScreenFrame title="Workout template">
				<StatusMessage tone="error">
					This template contains unavailable exercises or invalid data. Restore the missing
					references before starting or editing it.
				</StatusMessage>
				<Button onClick={source.refetch}>Retry template</Button>
			</PluginScreenFrame>
		);
	}
	if (draft === undefined || context.data === undefined || exercises.data === undefined) {
		return (
			<PluginScreenFrame title="Workout template">
				<StatusMessage tone="pending">Loading template…</StatusMessage>
			</PluginScreenFrame>
		);
	}
	const names = supersetNames(draft);
	const plannedSets = draft.occurrences.reduce((total, { sets }) => total + sets.length, 0);
	return (
		<PluginScreenFrame hideTitle title={draft.name}>
			<ManagedAssetProvider
				assets={managedAssetBatch(exercises.data.map((exercise) => exercise.images?.[0]))}
			>
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 font-ui">
					<header
						className={clsx(
							"flex gap-4",
							compact ? "flex-col" : "flex-row flex-wrap items-end justify-between",
						)}
					>
						<div className="flex min-w-0 flex-col gap-2">
							<span className="text-[13px] font-semibold tracking-wide text-accent-text uppercase">
								Workout template
							</span>
							<h1
								className={clsx(
									"font-display font-semibold text-text [overflow-wrap:anywhere]",
									compact ? "text-[34px] leading-tight" : "text-5xl leading-none",
								)}
							>
								{draft.name}
							</h1>
						</div>
						<div className={clsx("flex gap-2", compact && "w-full")}>
							<Button onClick={() => action("start")} className={clsx(compact && "flex-1")}>
								Start workout
							</Button>
							<Button variant="secondary" onClick={() => action("edit")}>
								Edit template{context.data.proAvailable ? "" : " (Pro)"}
							</Button>
						</div>
					</header>
					<section
						aria-label="Summary"
						className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-card bg-border"
					>
						{[
							{ label: "Exercises", value: draft.occurrences.length },
							{ value: plannedSets, label: "Planned sets" },
						].map((stat) => (
							<div key={stat.label} className="flex flex-col gap-1 bg-surface p-4">
								<span className="text-[13px] text-text-muted">{stat.label}</span>
								<span
									className={clsx(
										"leading-tight font-semibold text-text tabular-nums",
										compact ? "text-xl" : "text-[28px]",
									)}
								>
									{stat.value}
								</span>
							</div>
						))}
					</section>
					{draft.comment ? (
						<Card className="text-[15px] whitespace-pre-wrap text-text">{draft.comment}</Card>
					) : null}
					<WorkoutMediaViewer label={draft.name} images={draft.images} videos={draft.videos} />
					<section aria-label="Planned exercises" className="flex flex-col gap-4">
						<div className="flex items-baseline justify-between">
							<h2 className="font-display text-[22px] font-semibold text-text">Exercises</h2>
							<span className="text-[14px] text-text-muted">
								{draft.occurrences.length}{" "}
								{draft.occurrences.length === 1 ? "exercise" : "exercises"} · {plannedSets}{" "}
								{plannedSets === 1 ? "set" : "sets"}
							</span>
						</div>
						<div className={clsx("grid items-start gap-4", !compact && "grid-cols-2")}>
							{draft.occurrences.map((occurrence) => {
								const exercise = exercises.data?.find(({ id }) => id === occurrence.exerciseId);
								const group = draft.supersets.find(({ occurrenceIds }) =>
									occurrenceIds.includes(occurrence.clientId),
								);
								return (
									<PlannedExercise
										compact={compact}
										imperial={imperial}
										exercise={exercise}
										occurrence={occurrence}
										key={occurrence.clientId}
										group={
											group === undefined
												? undefined
												: { color: group.color, name: names.get(group.clientId) ?? "Superset" }
										}
									/>
								);
							})}
						</div>
					</section>
				</div>
			</ManagedAssetProvider>
		</PluginScreenFrame>
	);
}

function PlannedExercise(props: {
	readonly compact: boolean;
	readonly imperial: boolean;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly exercise: EditorExercise | undefined;
	readonly group: { readonly name: string; readonly color: string } | undefined;
}) {
	const { exercise, occurrence } = props;
	const name = exercise?.name ?? "Exercise unavailable";
	const notes = occurrence.notes.join("\n").trim();
	const meta = exercise === undefined ? "" : formatExerciseMeta(exercise);
	const labels = setLabels(occurrence.sets.map(({ setLot }) => setLot));
	return (
		<Card
			padding="none"
			className="min-w-0 overflow-hidden"
			groupColor={props.group === undefined ? undefined : supersetColor(props.group.color)}
		>
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<AssetArtWell
					name={name}
					asset={exercise?.images?.[0]}
					className={clsx("shrink-0", props.compact ? "size-11" : "size-14")}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className="text-[16px] font-semibold text-text [overflow-wrap:anywhere]">{name}</h3>
					<p className="text-[13px] text-text-muted">
						{meta}
						{props.group === undefined ? null : (
							<span
								className="font-semibold"
								style={{ color: supersetColorVariable(props.group.color) }}
							>
								{meta === "" ? "" : " · "}
								{props.group.name}
							</span>
						)}
					</p>
				</div>
			</div>
			{notes === "" ? null : (
				<p className="mx-4 mb-3 rounded-md bg-surface-2 px-3 py-2 text-[14px] whitespace-pre-wrap text-text-muted">
					{notes}
				</p>
			)}
			{occurrence.sets.length === 0 ? (
				<p className="border-t border-border px-4 py-2.5 text-[14px] text-text-muted">
					No planned sets.
				</p>
			) : (
				<ol aria-label={`Planned sets for ${name}`}>
					{occurrence.sets.map((set, index) => {
						const lot = setLots[set.setLot];
						return (
							<li
								key={set.clientId}
								className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-2 border-t border-border px-4 py-2.5 text-[15px]"
							>
								<span className={clsx("text-[13px] font-semibold", lot.tone ?? "text-text-muted")}>
									{labels[index]}
								</span>
								<span className="text-text">
									{formatSetMain(
										occurrence.exerciseKind,
										{
											reps: number(set.reps),
											weight: number(set.weight),
											distance: number(set.distance),
											duration: number(set.duration),
										},
										props.imperial,
										durationDisplayUnit(exercise?.overrides.defaultDurationUnit),
									) || "Measurements not specified"}
									<span className="text-[13px] text-text-muted">
										{set.restChoice.kind === "explicit"
											? ` · Rest ${formatClock(Number(set.restChoice.seconds))}`
											: ""}
										{set.rpe === undefined ? "" : ` · RPE ${set.rpe}`}
									</span>
								</span>
								{set.note ? (
									<p className="col-start-2 text-[13px] text-text-muted italic">“{set.note}”</p>
								) : null}
							</li>
						);
					})}
				</ol>
			)}
			<WorkoutMediaViewer label={name} images={occurrence.images} videos={occurrence.videos} />
		</Card>
	);
}

export default function WorkoutTemplatePage() {
	const location = usePluginLocation();
	return location.kind === "entity" ? <TemplateDetails entityId={location.entityId} /> : null;
}
