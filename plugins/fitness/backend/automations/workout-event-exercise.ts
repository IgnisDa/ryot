import type { AutomationPolicyInput } from "@ryot-app/plugin-backend-sdk/automation";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { IsoDateString } from "@ryot-app/plugin-backend-sdk/ryotql";

type Automation = AutomationPolicyInput["automation"];
type EventDraft = Extract<
	Automation["payload"],
	{ readonly resource: "event"; readonly operation: "create" }
>["draft"];

export const workoutEventExercise = (
	automation: Pick<Automation, "references">,
	draft: Pick<EventDraft, "entityId" | "sessionEntityId" | "eventSchemaPluginId">,
) => {
	const workout =
		draft.sessionEntityId === null ? undefined : automation.references?.[draft.sessionEntityId];
	const exercise = automation.references?.[draft.entityId];
	if (
		exercise?.entitySchemaSlug !== "exercise" ||
		exercise.entitySchemaPluginId !== draft.eventSchemaPluginId ||
		workout?.entitySchemaSlug !== "workout" ||
		workout.entitySchemaPluginId !== draft.eventSchemaPluginId ||
		Schema.decodeUnknownResult(IsoDateString)(workout.properties["startedAt"])._tag === "Failure"
	) {
		return undefined;
	}
	return exercise;
};
