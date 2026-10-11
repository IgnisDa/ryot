import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePluginLocation, usePluginParams } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useCallback } from "react";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import { fitnessRoute, workoutEditorResumeTarget } from "../../shared/workout-editor-routes";
import { cloneWorkoutEditorSource } from "../../shared/workout-editor-transformations";
import { emptyWorkoutDraft } from "./actions";
import { loadEditorSource } from "./queries";
import { WorkoutEditorScreen } from "./screen";

export default function WorkoutEditorPage() {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const location = usePluginLocation();
	const params = usePluginParams();
	const path = location.kind === "route" ? location.path : "/workout-editor";
	const sourceKind = path.startsWith("/templates/") ? "template" : "workout";
	const entityId = sourceKind === "template" ? params["templateId"] : params["workoutId"];
	const prepare = (context: typeof WorkoutEditorContextOutputSchema.Type) =>
		Effect.gen(function* () {
			const templateCreate = path === "/templates/new" || path.endsWith("/create-template");
			if (templateCreate && !context.proAvailable) {
				return yield* Effect.fail("Creating templates requires Pro. No new draft was started.");
			}
			const draftId = crypto.randomUUID();
			if (path === "/workouts/new" || path === "/templates/new") {
				return emptyWorkoutDraft({
					id: draftId,
					template: templateCreate,
					settings: context.settings,
					now: DateTime.formatIso(DateTime.makeUnsafe(schedule.now())),
				});
			}
			if (entityId === undefined) {
				return yield* Effect.fail("This editor action is invalid.");
			}
			const source = yield* loadEditorSource(client, { draftId, entityId, kind: sourceKind });
			if (source.kind === "blocked") {
				return yield* Effect.fail(
					`This record contains unavailable exercises or invalid data (${[...new Set(source.blockers.map(({ exerciseId }) => exerciseId))].join(", ")}). Restore the missing exercise or correct the record, then retry.`,
				);
			}
			if (path.endsWith("/edit")) {
				return source.draft;
			}
			if (path.endsWith("/create-template")) {
				return cloneWorkoutEditorSource(source.draft, {
					draftId,
					kind: "template-create",
					name: source.draft.name,
					idFor: () => crypto.randomUUID(),
					sourceWorkoutId:
						source.draft.mode.kind === "historical"
							? source.draft.mode.entityId
							: yield* Effect.fail("Invalid workout source."),
				});
			}
			const startedAt = DateTime.formatIso(DateTime.makeUnsafe(schedule.now()));
			if (source.draft.mode.kind === "template-edit") {
				return cloneWorkoutEditorSource(source.draft, {
					draftId,
					startedAt,
					kind: "live",
					name: source.draft.name,
					idFor: () => crypto.randomUUID(),
					templateId: source.draft.mode.entityId,
				});
			}
			if (source.draft.mode.kind !== "historical") {
				return yield* Effect.fail("Invalid workout source.");
			}
			return cloneWorkoutEditorSource(source.draft, {
				draftId,
				startedAt,
				kind: "repeat",
				name: source.draft.name,
				idFor: () => crypto.randomUUID(),
				sourceWorkoutId: source.draft.mode.entityId,
			});
		});
	const started = useCallback(
		() => client.navigation.replace(fitnessRoute("/workout-editor")),
		[client],
	);
	return (
		<WorkoutEditorScreen
			target={workoutEditorResumeTarget}
			requiresPro={path === "/templates/new" || path.endsWith("/create-template")}
			{...(path === "/workout-editor" ? {} : { prepareDraft: prepare })}
			onStarted={started}
			onSaved={(savedId) => client.navigation.replace({ kind: "entity", entityId: savedId })}
		/>
	);
}
