import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Review Created Detector",
	slug: "automation.review-created",
	inputProjection: { event: { properties: [], compareProperties: [] } },
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (
			payload.category !== "change" ||
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
