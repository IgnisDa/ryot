import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	WorkoutEditorContextInputSchema,
	WorkoutEditorContextOutputSchema,
} from "../../shared/workout-editor-context-operations";
import { WorkoutPreferenceSettingsSchema } from "../../shared/workout-editor-preferences";

export const manifest = defineManifest({
	kind: "operation",
	name: "Load workout editor context",
	slug: "operation.workout-editor-context",
});

export default defineOperation({
	manifest,
	input: WorkoutEditorContextInputSchema,
	output: WorkoutEditorContextOutputSchema,
	run: (_, host) =>
		Effect.gen(function* () {
			const settings = yield* Schema.decodeUnknownEffect(WorkoutPreferenceSettingsSchema)(
				yield* host.getUserSettings(),
			);
			return { settings, proAvailable: yield* host.getProAvailability() };
		}),
});
