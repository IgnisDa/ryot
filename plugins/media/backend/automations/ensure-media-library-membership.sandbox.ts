import { defineAutomation, type AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { mediaLibraryMemberEntitySchemaSlugs } from "../contracts/schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Ensure media library membership",
	slug: "automation.ensure-media-library-membership",
	capabilities: ["executeRyotql", "changeUserRelationships"],
	inputProjection: {
		providerEntityImport: true,
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
		event: { compareProperties: [], properties: ["entityId", "entitySchemaSlug"] },
	},
});

const libraryMemberEntitySchemaSlugs = new Set<string>(mediaLibraryMemberEntitySchemaSlugs);

type MediaLibraryTarget = { entityId: string; entitySchemaSlug: string };

const collectionMembershipTarget = (event: {
	properties: Readonly<Record<string, unknown>>;
}): MediaLibraryTarget | null => {
	const entityId = event.properties["entityId"];
	const entitySchemaSlug = event.properties["entitySchemaSlug"];
	return typeof entityId === "string" && typeof entitySchemaSlug === "string"
		? { entityId, entitySchemaSlug }
		: null;
};

const mediaLibraryTarget = (
	payload: AutomationInput["automation"]["payload"],
): MediaLibraryTarget | null => {
	if (payload.resource === "provider-entity-import") {
		return { entityId: payload.entityId, entitySchemaSlug: payload.entitySchemaSlug };
	}
	if (payload.resource === "entity" && payload.operation === "create" && "after" in payload) {
		return { entityId: payload.after.id, entitySchemaSlug: payload.after.entitySchemaSlug };
	}
	if (payload.resource === "event" && payload.operation === "create" && "after" in payload) {
		const event = payload.after;
		return event.entitySchemaSlug === "collection" &&
			event.eventSchemaSlug === "add-entity-to-collection"
			? collectionMembershipTarget(event)
			: { entityId: event.entityId, entitySchemaSlug: event.entitySchemaSlug };
	}
	return null;
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (
				payload.resource === "provider-entity-import" &&
				payload.userId !== automation.executionUserId
			) {
				return yield* Effect.fail(new Error("Provider import user does not match execution user"));
			}
			const target = mediaLibraryTarget(payload);
			if (!target || !libraryMemberEntitySchemaSlugs.has(target.entitySchemaSlug)) {
				return null;
			}
			const mediaLibrary = yield* executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe());
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: target.entityId,
							targetEntityId: mediaLibrary.entityId,
							relationshipSchemaSlug: "in-media-library",
						},
					],
				},
			]);
			return null;
		}),
});
