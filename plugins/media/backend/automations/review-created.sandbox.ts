import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { automationOccurrenceRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Review Created Detector",
	slug: "automation.review-created",
	capabilities: ["executeRyotql", "emitSignal"],
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.origin.kind !== "api" || automation.source.kind !== "event") {
			return Effect.succeed(null);
		}
		return executeRyotqlRecipe(
			host.executeRyotql,
			automationOccurrenceRecipe(automation.occurrenceId),
		).pipe(
			Effect.flatMap((occurrence) => {
				const event = occurrence?.source.kind === "event" ? occurrence.source.after : undefined;
				return event?.eventSchemaSlug === "review"
					? host.emitSignal({
							discriminator: event.id,
							schemaSlug: "review.created",
							properties: {
								reviewEventId: event.id,
								entityId: event.subject.id,
								entityName: event.subject.name,
								entitySchemaSlug: event.subject.entitySchemaSlug,
							},
						})
					: Effect.succeed(null);
			}),
		);
	},
});
