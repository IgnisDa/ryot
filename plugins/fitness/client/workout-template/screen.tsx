import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import { WorkoutMediaViewer } from "../media-viewer";
import { workoutEditorContextQuery } from "../workout-editor/context-query";
import { editorExercisesQuery, loadEditorSource } from "../workout-editor/queries";
import { formatClock, formatSetMain } from "../workout/format";

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
	return (
		<PluginScreenFrame hideTitle title={draft.name}>
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-5 font-ui">
				<header className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="text-sm text-text-muted">Workout template</p>
						<h1 className="font-display text-3xl font-semibold">{draft.name}</h1>
					</div>
					<div className="flex gap-2">
						<Button onClick={() => action("start")}>Start workout</Button>
						<Button variant="secondary" onClick={() => action("edit")}>
							Edit template{context.data.proAvailable ? "" : " (Pro)"}
						</Button>
					</div>
				</header>
				<p>
					{draft.occurrences.length} exercises ·{" "}
					{draft.occurrences.reduce((total, { sets }) => total + sets.length, 0)} planned sets
				</p>
				{draft.comment ? <p className="whitespace-pre-wrap">{draft.comment}</p> : null}
				<WorkoutMediaViewer label={draft.name} images={draft.images} videos={draft.videos} />
				<section aria-label="Planned exercises" className="flex flex-col gap-4">
					{draft.occurrences.map((occurrence, index) => {
						const exercise = exercises.data?.find(({ id }) => id === occurrence.exerciseId);
						const group = draft.supersets.find(({ occurrenceIds }) =>
							occurrenceIds.includes(occurrence.clientId),
						);
						return (
							<article
								key={occurrence.clientId}
								className="rounded-xl border border-border bg-surface p-4"
							>
								<h2 className="text-lg font-semibold">
									{index + 1}. {exercise?.name ?? "Exercise unavailable"}
								</h2>
								{group ? <p>Superset {draft.supersets.indexOf(group) + 1}</p> : null}
								<p className="whitespace-pre-wrap">{occurrence.notes.join("\n")}</p>
								{occurrence.sets.length === 0 ? (
									<p>No planned sets.</p>
								) : (
									<ol>
										{occurrence.sets.map((set, setIndex) => (
											<li key={set.clientId} className="border-t border-border py-2">
												Set {setIndex + 1} · {set.setLot.replaceAll("_", " ")} ·{" "}
												{formatSetMain(
													occurrence.exerciseKind,
													{
														reps: number(set.reps),
														weight: number(set.weight),
														distance: number(set.distance),
														duration: number(set.duration),
													},
													imperial,
													exercise?.overrides.defaultDurationUnit ?? "minutes",
												) || "Measurements not specified"}
												{set.restChoice.kind === "explicit"
													? ` · Rest ${formatClock(Number(set.restChoice.seconds))}`
													: ""}
												{set.rpe === undefined ? "" : ` · RPE ${set.rpe}`}
												{set.note ? <p>{set.note}</p> : null}
											</li>
										))}
									</ol>
								)}
								<WorkoutMediaViewer
									images={occurrence.images}
									videos={occurrence.videos}
									label={exercise?.name ?? "Exercise"}
								/>
							</article>
						);
					})}
				</section>
			</div>
		</PluginScreenFrame>
	);
}

export default function WorkoutTemplatePage() {
	const location = usePluginLocation();
	return location.kind === "entity" ? <TemplateDetails entityId={location.entityId} /> : null;
}
