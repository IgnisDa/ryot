import { defineAutomation, notifySignals } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { catalogMessage } from "../../shared/messages.generated";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Fitness Signal Notification",
	slug: "automation.fitness-notification",
	inputProjection: { signal: { properties: ["workoutName"] } },
});

export default defineAutomation({
	manifest,
	run: notifySignals({
		"workout.created": {
			properties: Schema.Struct({ workoutName: Schema.String }),
			notify: ({ workoutName }) => catalogMessage("notification.workout-created", { workoutName }),
		},
	}),
});
