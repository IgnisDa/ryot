import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Review Created Detector",
	slug: "automation.review-created",
	capabilities: ["executeRyotql", "emitSignal"],
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (
			payload.resource !== "event" ||
			payload.operation !== "create" ||
			payload.after.eventSchemaSlug !== "review"
		) {
			return Effect.succeed(null);
		}
		const event = payload.after;
		return executeRyotqlRecipe(
			host.executeRyotql,
			entityReadRecipe({ entityIds: [event.entityId] }),
		).pipe(
			Effect.flatMap(({ items }) => {
				const entity = items[0];
				return entity
					? host.emitSignal({
							discriminator: event.id,
							schemaSlug: "review.created",
							properties: {
								reviewEventId: event.id,
								entityName: entity.name,
								entityId: event.entityId,
								entitySchemaSlug: event.entitySchemaSlug,
							},
						})
					: Effect.succeed(null);
			}),
		);
	},
});
