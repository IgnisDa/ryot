import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { eventSchemaBySlug, fetchEntity } from "../lib/host-reads";

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
			if (
				payload.resource !== "relationship" ||
				payload.operation !== "create" ||
				payload.after.relationshipSchemaSlug !== "in-media-library"
			) {
				return null;
			}
			const entity = yield* fetchEntity(host, payload.after.sourceEntityId);
			if (!libraryMemberEntitySchemaSlugs.has(entity.entitySchemaSlug)) {
				return null;
			}
			const eventSchema = yield* eventSchemaBySlug(
				host,
				entity.entitySchemaSlug,
				"add-to-media-library",
			);
			if (eventSchema === null) {
				return null;
			}
			yield* host.createEvents([
				{
					properties: {},
					entityId: entity.id,
					eventSchemaSlug: eventSchema.slug,
					occurredAt: payload.after.createdAt,
				},
			]);
			return null;
		}),
});
