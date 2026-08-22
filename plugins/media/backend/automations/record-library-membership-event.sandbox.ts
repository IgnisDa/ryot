import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import type { EventSchemaRecord, SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { mediaLibraryMemberEntitySchemaSlugs } from "../contracts/schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Record media library membership event",
	slug: "automation.record-library-membership-event",
	capabilities: ["executeRyotql", "createEvents", "listEventSchemas"],
	inputProjection: {
		relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

const libraryMemberEntitySchemaSlugs = new Set<string>(mediaLibraryMemberEntitySchemaSlugs);

type AutomationHost = SandboxHost<typeof manifest.capabilities>;

const sourceEntity = (host: AutomationHost, entityId: string) =>
	executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({ entityIds: [entityId] })).pipe(
		Effect.flatMap(({ items }) => {
			const entity = items[0];
			return entity ? Effect.succeed(entity) : Effect.fail(new Error("Entity not found"));
		}),
	);

const libraryEventSchema = (host: AutomationHost, entitySchemaSlug: string) =>
	host
		.listEventSchemas([entitySchemaSlug])
		.pipe(
			Effect.map(
				(schemas): EventSchemaRecord | null =>
					schemas.find((schema) => schema.slug === "add-to-library") ?? null,
			),
		);

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (
				payload.resource !== "relationship" ||
				payload.operation !== "create" ||
				payload.after.relationshipSchemaSlug !== "in-library"
			) {
				return null;
			}
			const entity = yield* sourceEntity(host, payload.after.sourceEntityId);
			if (!libraryMemberEntitySchemaSlugs.has(entity.entitySchemaSlug)) {
				return null;
			}
			const eventSchema = yield* libraryEventSchema(host, entity.entitySchemaSlug);
			if (eventSchema === null) {
				return null;
			}
			yield* host.createEvents([
				{
					properties: {},
					entityId: entity.id,
					eventSchemaSlug: eventSchema.id,
					occurredAt: payload.after.createdAt,
				},
			]);
			return null;
		}),
});
