import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginLocation, usePluginParams } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useCallback } from "react";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import { fitnessRoute, workoutEditorResumeTarget } from "../../shared/workout-editor-routes";
import { cloneWorkoutEditorSource } from "../../shared/workout-editor-transformations";
import { emptyWorkoutDraft } from "./actions";
import { toIso } from "./clock";
import { WorkoutEditorPrepareError } from "./prepare-error";
import { loadEditorSource } from "./queries";
import { WorkoutEditorScreen } from "./screen";

const idFor = () => crypto.randomUUID();
const prepareFailure = (message: string) => Effect.fail(new WorkoutEditorPrepareError({ message }));

export default function WorkoutEditorPage() {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const location = usePluginLocation();
	const params = usePluginParams();
	const pendingAddExerciseId = new URLSearchParams(location.search).get("add") ?? undefined;
	const path = location.kind === "route" ? location.path : "/workout-editor";
	const sourceKind = path.startsWith("/templates/") ? "template" : "workout";
	const entityId = sourceKind === "template" ? params["templateId"] : params["workoutId"];
	const templateCreate = path === "/templates/new" || path.endsWith("/create-template");
	const prepare = (context: typeof WorkoutEditorContextOutputSchema.Type) =>
		Effect.gen(function* () {
			if (templateCreate && !context.proAvailable) {
				return yield* prepareFailure("Creating templates requires Pro. No new draft was started.");
			}
			const draftId = idFor();
			if (path === "/workouts/new" || path === "/templates/new") {
				return emptyWorkoutDraft({
					id: draftId,
					template: templateCreate,
					now: toIso(schedule.now()),
					settings: context.settings,
				});
			}
			if (entityId === undefined) {
				return yield* prepareFailure("This editor action is invalid.");
			}
			const source = yield* loadEditorSource(client, { draftId, entityId, kind: sourceKind });
			if (source.kind === "blocked") {
				return yield* prepareFailure(
					`This record contains unavailable exercises or invalid data (${[...new Set(source.blockers.map(({ exerciseId }) => exerciseId))].join(", ")}). Restore the missing exercise or correct the record, then retry.`,
				);
			}
			if (path.endsWith("/edit")) {
				return source.draft;
			}
			const { mode } = source.draft;
			if (templateCreate) {
				return mode.kind === "historical"
					? cloneWorkoutEditorSource(source.draft, {
							idFor,
							draftId,
							kind: "template-create",
							name: source.draft.name,
							sourceWorkoutId: mode.entityId,
						})
					: yield* prepareFailure("Invalid workout source.");
			}
			const startedAt = toIso(schedule.now());
			if (mode.kind === "template-edit") {
				return cloneWorkoutEditorSource(source.draft, {
					idFor,
					draftId,
					startedAt,
					kind: "live",
					name: source.draft.name,
					templateId: mode.entityId,
				});
			}
			if (mode.kind !== "historical") {
				return yield* prepareFailure("Invalid workout source.");
			}
			return cloneWorkoutEditorSource(source.draft, {
				idFor,
				draftId,
				startedAt,
				kind: "repeat",
				name: source.draft.name,
				sourceWorkoutId: mode.entityId,
			});
		});
	const started = useCallback(
		() => client.navigation.replace(fitnessRoute("/workout-editor")),
		[client],
	);
	return (
		<WorkoutEditorScreen
			requiresPro={templateCreate}
			target={workoutEditorResumeTarget}
			pendingAddExerciseId={pendingAddExerciseId}
			{...(path === "/workout-editor" ? {} : { prepareDraft: prepare })}
			onStarted={started}
			onSaved={(savedId) => client.navigation.replace({ kind: "entity", entityId: savedId })}
		/>
	);
}
