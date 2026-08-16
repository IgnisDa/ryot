import { defineAutomation, type AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe, userLibraryRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { mediaLibraryMemberEntitySchemaSlugs } from "../contracts/schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Ensure media library membership",
	slug: "automation.ensure-library-membership",
	capabilities: ["executeRyotql", "changeUserRelationships"],
});

const libraryMemberEntitySchemaSlugs = new Set<string>(mediaLibraryMemberEntitySchemaSlugs);

type LibraryTarget = { entityId: string; entitySchemaSlug: string };

const collectionMembershipTarget = (event: {
	properties: Readonly<Record<string, unknown>>;
}): LibraryTarget | null => {
	const entityId = event.properties["entityId"];
	const entitySchemaSlug = event.properties["entitySchemaSlug"];
	return typeof entityId === "string" && typeof entitySchemaSlug === "string"
		? { entityId, entitySchemaSlug }
		: null;
};

const libraryTarget = (payload: AutomationInput["automation"]["payload"]): LibraryTarget | null => {
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
			if (automation.executionUserId === null) {
				return null;
			}
			const payload = automation.payload;
			if (
				payload.resource === "provider-entity-import" &&
				payload.userId !== automation.executionUserId
			) {
				return yield* Effect.fail(new Error("Provider import user does not match execution user"));
			}
			const target = libraryTarget(payload);
			if (!target || !libraryMemberEntitySchemaSlugs.has(target.entitySchemaSlug)) {
				return null;
			}
			const library = yield* executeRyotqlRecipe(host.executeRyotql, userLibraryRecipe());
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: target.entityId,
							targetEntityId: library.entityId,
							relationshipSchemaSlug: "in-library",
						},
					],
				},
			]);
			return null;
		}),
});
