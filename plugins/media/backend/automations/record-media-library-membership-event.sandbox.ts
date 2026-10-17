import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import type { CreateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { MediaSandboxError } from "../lib/failures";
import { eventSchemaBySlug } from "../lib/host-reads";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Record media library membership event",
	slug: "automation.record-media-library-membership-event",
	inputProjection: {
		relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

const libraryMemberEntitySchemaSlugs = new Set<string>(mediaLibraryMemberEntitySchemaSlugs);

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (payload.resource !== "relationship" || payload.operation !== "batch") {
				return null;
			}
			const memberships = payload.items.flatMap((item) =>
				item.operation === "create" && item.after.relationshipSchemaSlug === "in-media-library"
					? [item.after]
					: [],
			);
			const [firstEntityId, ...otherEntityIds] = new Set(
				memberships.map(({ sourceEntityId }) => sourceEntityId),
			);
			if (firstEntityId === undefined) {
				return null;
			}
			const { items: entities } = yield* executeRyotqlRecipe(
				host.executeRyotql,
				entityReadRecipe({ entityIds: [firstEntityId, ...otherEntityIds] }),
			);
			const entitySlugById = new Map(
				entities.map((entity) => [entity.id, entity.entitySchemaSlug]),
			);
			const eventSchemaSlugsByEntitySchema = new Map<string, string | null>();
			const events: CreateEventItem[] = [];
			for (const { createdAt, sourceEntityId } of memberships) {
				const entitySchemaSlug = entitySlugById.get(sourceEntityId);
				if (entitySchemaSlug === undefined) {
					return yield* new MediaSandboxError({ message: "Entity not found" });
				}
				if (!libraryMemberEntitySchemaSlugs.has(entitySchemaSlug)) {
					continue;
				}
				if (!eventSchemaSlugsByEntitySchema.has(entitySchemaSlug)) {
					const eventSchema = yield* eventSchemaBySlug(
						host,
						entitySchemaSlug,
						"add-to-media-library",
					);
					eventSchemaSlugsByEntitySchema.set(entitySchemaSlug, eventSchema?.slug ?? null);
				}
				const eventSchemaSlug = eventSchemaSlugsByEntitySchema.get(entitySchemaSlug);
				if (eventSchemaSlug === null || eventSchemaSlug === undefined) {
					continue;
				}
				events.push({
					properties: {},
					eventSchemaSlug,
					occurredAt: createdAt,
					entityId: sourceEntityId,
				});
			}
			if (events.length > 0) {
				yield* host.createEvents(events);
			}
			return null;
		}),
});
