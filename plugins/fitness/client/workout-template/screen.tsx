import { usePluginLocation, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { ManagedAssetProvider, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, Card, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

import { supersetColor } from "../../shared/superset-colors";
import type { TemplateOccurrenceProperties } from "../../shared/workout-editor-properties";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import { durationDisplayUnit } from "../../shared/workout-units";
import { AssetArtWell, managedAssetBatch } from "../asset-urls";
import { useAddToCollection } from "../collections";
import { DeleteFitnessEntity } from "../entity-delete";
import { supersetColorVariable, supersetName } from "../group-colors";
import { HeaderActionsMenu } from "../header-actions-menu";
import { WorkoutMediaViewer } from "../media-viewer";
import { setLabels, setLots } from "../set-lots";
import { workoutEditorContextQuery } from "../workout-editor/context-query";
import { formatClock, formatExerciseMeta, formatSetMain } from "../workout/format";
import { type TemplateExercise, templateQuery } from "./queries";

export default function WorkoutTemplatePage() {
	const location = usePluginLocation();
	return location.kind === "entity" ? <TemplateDetails entityId={location.entityId} /> : null;
}

function PlannedExercise(props: {
	readonly compact: boolean;
	readonly imperial: boolean;
	readonly exercise: undefined | TemplateExercise;
	readonly occurrence: TemplateOccurrenceProperties;
	readonly group: undefined | { readonly name: string; readonly color: string };
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
					<h3 className="text-[16px] font-semibold text-text wrap-anywhere">{name}</h3>
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
								key={set.setOrder}
								className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-2 border-t border-border px-4 py-2.5 text-[15px]"
							>
								<span className={clsx("text-[13px] font-semibold", lot.tone ?? "text-text-muted")}>
									{labels[index]}
								</span>
								<span className="text-text">
									{formatSetMain(
										exercise?.exerciseKind ?? null,
										{
											reps: set.reps ?? null,
											weight: set.weight ?? null,
											distance: set.distance ?? null,
											duration: set.duration ?? null,
										},
										props.imperial,
										durationDisplayUnit(exercise?.overrides.defaultDurationUnit),
									) || "Measurements not specified"}
									<span className="text-[13px] text-text-muted">
										{set.restTime == null ? "" : ` · Rest ${formatClock(set.restTime)}`}
										{set.rpe == null ? "" : ` · RPE ${set.rpe}`}
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
			<WorkoutMediaViewer
				label={name}
				images={occurrence.images ?? []}
				videos={occurrence.videos ?? []}
			/>
		</Card>
	);
}

function TemplateDetails(props: { readonly entityId: string }) {
	const client = useRyot();
	const { compact } = useRyotViewport();
	const source = useRyotQuery(templateQuery, props.entityId);
	const context = useRyotQuery(workoutEditorContextQuery, undefined);
	const template = source.data?.kind === "ready" ? source.data : undefined;
	const [dialog, setDialog] = useState<"delete">();
	const addToCollection = useAddToCollection();
	const imperial = context.data?.settings.unitSystem === "imperial";
	const action = (kind: "edit" | "start") =>
		client.navigation.push(
			fitnessRoute(`/templates/${encodeURIComponent(props.entityId)}/${kind}`),
		);
	if (source.isError || context.isError) {
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
	if (template === undefined || context.data === undefined) {
		return (
			<PluginScreenFrame title="Workout template">
				<StatusMessage tone="pending">Loading template…</StatusMessage>
			</PluginScreenFrame>
		);
	}
	const { plan, entity, exercises } = template;
	const names = new Map<number, string>();
	for (const occurrence of plan.exercises) {
		const index = plan.supersets?.findIndex(({ exercises: orders }) =>
			orders.includes(occurrence.exerciseOrder),
		);
		if (index !== undefined && index !== -1 && !names.has(index)) {
			names.set(index, supersetName(names.size));
		}
	}
	const plannedSets = plan.exercises.reduce((total, { sets }) => total + sets.length, 0);
	return (
		<PluginScreenFrame hideTitle title={entity.name}>
			<ManagedAssetProvider
				assets={managedAssetBatch(exercises.map((exercise) => exercise.images?.[0]))}
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
									"font-display font-semibold text-text wrap-anywhere",
									compact ? "text-[34px] leading-tight" : "text-5xl leading-none",
								)}
							>
								{entity.name}
							</h1>
						</div>
						<div className={clsx("flex gap-2", compact && "w-full")}>
							<Button onClick={() => action("start")} className={clsx(compact && "flex-1")}>
								Start workout
							</Button>
							<Button variant="secondary" onClick={() => action("edit")}>
								Edit template{context.data.proAvailable ? "" : " (Pro)"}
							</Button>
							<HeaderActionsMenu
								label="More template actions"
								items={[
									{
										key: "collections",
										label: "Add to collection",
										onSelect: () => addToCollection(props.entityId),
									},
									{
										key: "delete",
										destructive: true,
										label: "Delete template",
										onSelect: () => setDialog("delete"),
									},
								]}
							/>
							{dialog === "delete" ? (
								<DeleteFitnessEntity
									kind="template"
									name={entity.name}
									entityId={props.entityId}
									onClose={() => setDialog(undefined)}
								/>
							) : null}
						</div>
					</header>
					<section
						aria-label="Summary"
						className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-card bg-border"
					>
						{[
							{ label: "Exercises", value: plan.exercises.length },
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
					{plan.comment ? (
						<Card className="text-[15px] whitespace-pre-wrap text-text">{plan.comment}</Card>
					) : null}
					<WorkoutMediaViewer
						label={entity.name}
						images={plan.images ?? []}
						videos={plan.videos ?? []}
					/>
					<section aria-label="Planned exercises" className="flex flex-col gap-4">
						<div className="flex items-baseline justify-between">
							<h2 className="font-display text-[22px] font-semibold text-text">Exercises</h2>
							<span className="text-[14px] text-text-muted">
								{plan.exercises.length} {plan.exercises.length === 1 ? "exercise" : "exercises"} ·{" "}
								{plannedSets} {plannedSets === 1 ? "set" : "sets"}
							</span>
						</div>
						<div className={clsx("grid items-start gap-4", !compact && "grid-cols-2")}>
							{plan.exercises.map((occurrence) => {
								const exercise = exercises.find(({ id }) => id === occurrence.exerciseId);
								const groupIndex = plan.supersets?.findIndex(({ exercises: orders }) =>
									orders.includes(occurrence.exerciseOrder),
								);
								const group = groupIndex === undefined ? undefined : plan.supersets?.[groupIndex];
								return (
									<PlannedExercise
										compact={compact}
										imperial={imperial}
										exercise={exercise}
										occurrence={occurrence}
										key={occurrence.exerciseOrder}
										group={
											group === undefined
												? undefined
												: { color: group.color, name: names.get(groupIndex ?? -1) ?? "Superset" }
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
