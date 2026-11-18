import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createUuid, usePluginLocation, usePluginParams } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useCallback } from "react";

import { catalogMessage } from "../../shared/messages.generated";
import { fitnessRoute, workoutEditorResumeTarget } from "../../shared/workout-editor-routes";
import { cloneWorkoutEditorSource } from "../../shared/workout-editor-transformations";
import { useFitnessMessages } from "../messages";
import { defaultWorkoutName, emptyWorkoutDraft } from "./actions";
import { toIso } from "./clock";
import type { WorkoutEditorContext } from "./controller-types";
import { WorkoutEditorPrepareError } from "./prepare-error";
import { loadEditorSource } from "./queries";
import { WorkoutEditorScreen } from "./screen";

const prepareFailure = (reason: LocalMessage) =>
	Effect.fail(new WorkoutEditorPrepareError({ reason }));

export default function WorkoutEditorPage() {
	const text = useFitnessMessages();
	const client = useRyot();
	const schedule = useRyotSchedule();
	const location = usePluginLocation();
	const params = usePluginParams();
	const pendingAddExerciseId = new URLSearchParams(location.search).get("add") ?? undefined;
	const path = location.kind === "route" ? location.path : "/workout-editor";
	const sourceKind = path.startsWith("/templates/") ? "template" : "workout";
	const entityId = sourceKind === "template" ? params["templateId"] : params["workoutId"];
	const templateCreate = path === "/templates/new" || path.endsWith("/create-template");
	const prepare = (context: WorkoutEditorContext) =>
		Effect.gen(function* () {
			if (templateCreate && !context.pro) {
				return yield* prepareFailure(catalogMessage("client.prepare.pro"));
			}
			const draftId = createUuid();
			if (path === "/workouts/new" || path === "/templates/new") {
				return emptyWorkoutDraft({
					id: draftId,
					template: templateCreate,
					now: toIso(schedule.now()),
					settings: context.settings,
					name: defaultWorkoutName(text, templateCreate),
				});
			}
			if (entityId === undefined) {
				return yield* prepareFailure(catalogMessage("client.prepare.invalid-action"));
			}
			const source = yield* loadEditorSource(client, { draftId, entityId, kind: sourceKind });
			if (source.kind === "blocked") {
				return yield* prepareFailure(
					catalogMessage("client.prepare.blocked", {
						ids: [...new Set(source.blockers.map(({ exerciseId }) => exerciseId))].join(", "),
					}),
				);
			}
			if (path.endsWith("/edit")) {
				return source.draft;
			}
			const { mode } = source.draft;
			if (templateCreate) {
				return mode.kind === "historical"
					? cloneWorkoutEditorSource(source.draft, {
							draftId,
							idFor: createUuid,
							kind: "template-create",
							name: source.draft.name,
							sourceWorkoutId: mode.entityId,
						})
					: yield* prepareFailure(catalogMessage("client.prepare.invalid-source"));
			}
			const startedAt = toIso(schedule.now());
			if (mode.kind === "template-edit") {
				return cloneWorkoutEditorSource(source.draft, {
					draftId,
					startedAt,
					kind: "live",
					idFor: createUuid,
					name: source.draft.name,
					templateId: mode.entityId,
				});
			}
			if (mode.kind !== "historical") {
				return yield* prepareFailure(catalogMessage("client.prepare.invalid-source"));
			}
			return cloneWorkoutEditorSource(source.draft, {
				draftId,
				startedAt,
				kind: "repeat",
				idFor: createUuid,
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
