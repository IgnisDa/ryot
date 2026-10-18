import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { mediaActivityEntitySchemaSlugs } from "../../shared/media-activity-fields";
import { historyCorrectionReference } from "../contracts/history-correction";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Reconcile media history",
	slug: "automation.reconcile-media-history",
	inputProjection: {
		event: { compareProperties: [], properties: ["completionKey"] },
		signal: { properties: ["entitySchemaSlug", "oldStatus", "newStatus"] },
	},
});

const activitySlugs = new Set<string>(mediaActivityEntitySchemaSlugs);
const subject = (event: {
	readonly entityId: string;
	readonly entitySchemaSlug: string;
	readonly sessionEntityId: string | null;
}) =>
	["show-episode", "podcast-episode"].includes(event.entitySchemaSlug)
		? (event.sessionEntityId ?? event.entityId)
		: event.entityId;

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const targets = new Map<string, Set<string>>();
			const add = (id: string) => {
				if (!targets.has(id)) {
					targets.set(id, new Set());
				}
			};
			const payload = automation.payload;
			let force = false;
			if (payload.resource === "event") {
				for (const item of payload.operation === "batch" ? payload.items : [payload]) {
					const event = item.operation === "delete" ? item.before : item.after;
					if (!activitySlugs.has(event.entitySchemaSlug)) {
						continue;
					}
					if (
						item.operation === "create" &&
						typeof event.properties["completionKey"] === "string"
					) {
						continue;
					}
					const id = subject(event);
					add(id);
					if (item.operation === "update") {
						add(subject(item.before));
					}
					if (item.operation === "create") {
						targets.get(id)?.add(event.id);
					}
				}
			} else if (
				payload.resource === "signal" &&
				payload.signalSchemaSlug === "media.status.changed" &&
				payload.subjectEntityId
			) {
				const schema = payload.properties["entitySchemaSlug"];
				if (schema !== "show" && schema !== "podcast") {
					return null;
				}
				force = true;
				add(payload.subjectEntityId);
			}
			for (const [entityId, sources] of targets) {
				const workKey = `${entityId}:${automation.runId}:start`;
				yield* host.requestUserWork(
					{
						key: workKey,
						scope: entityId,
						input: {
							force,
							workKey,
							entityId,
							conflictAttempt: 0,
							liveSourceIds: [...sources],
							requestKey: automation.runId,
						},
					},
					historyCorrectionReference,
				);
			}
			return null;
		}),
});
