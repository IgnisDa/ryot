import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { librarySummaryRequests } from "../lib/library-summary-requests";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Refresh media library summaries",
	slug: "automation.library-summary-refresh",
	inputProjection: {
		event: { compareProperties: [], properties: ["entityId", "sessionEntityId"] },
		relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			const titleIds = new Set<string>();
			if (payload.resource === "event" && payload.operation === "batch") {
				for (const item of payload.items) {
					for (const event of [
						"before" in item ? item.before : null,
						"after" in item ? item.after : null,
					]) {
						if (event) {
							titleIds.add(event.sessionEntityId ?? event.entityId);
						}
					}
				}
			}
			if (payload.resource === "relationship" && payload.operation === "batch") {
				for (const item of payload.items) {
					if (item.operation === "create") {
						titleIds.add(item.after.sourceEntityId);
					}
				}
			}
			for (const request of librarySummaryRequests(titleIds)) {
				yield* host.requestRelationshipProjections(request);
			}
			return null;
		}),
});
