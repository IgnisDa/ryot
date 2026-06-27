import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Review Created Detector",
	slug: "automation.review-created",
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const event = automation.source.kind === "event" ? automation.source.after : undefined;
		if (automation.origin.kind !== "api" || event?.eventSchemaSlug !== "review") {
			return Effect.succeed(null);
		}

		return host.emitSignal({
			discriminator: event.id,
			schemaSlug: "review.created",
			properties: {
				reviewEventId: event.id,
				entityId: event.subject.id,
				entityName: event.subject.name,
				entitySchemaSlug: event.subject.entitySchemaSlug,
			},
		});
	},
});
