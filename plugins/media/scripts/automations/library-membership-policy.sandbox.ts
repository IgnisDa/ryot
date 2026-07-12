import { defineAutomationPolicy, type AutomationPolicyInput } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import { buildUserLibraryQuery, queryFirstEntityId } from "../../media-monitoring";
import { mediaLibraryEligibleEntitySchemaSlugs } from "../../schemas/media-schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media library membership policy",
	slug: "policy.media-library-membership",
	capabilities: ["executeQueryEngine", "changeUserRelationships"],
});

const eligibleEntitySchemaSlugs = new Set<string>(mediaLibraryEligibleEntitySchemaSlugs);

const systemRef = (sourceAlias: string, name: string): JsonValue => ({
	type: "ref",
	sourceAlias,
	field: { type: "system", name },
});

const buildGlobalEntityQuery = (entityId: string, entitySchemaSlug: string) => {
	const where: JsonValue = {
		type: "and",
		values: [
			{
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: entityId },
				left: systemRef("entity", "id"),
			},
			{ type: "isNull", expr: systemRef("entity", "userId") },
		],
	};
	return {
		source: { where, alias: "entity", type: "entities", schemas: [entitySchemaSlug] },
		output: {
			type: "rows",
			pagination: { page: 1, limit: 1 },
			orderBy: [{ order: "asc", expr: systemRef("entity", "id") }],
			fields: [{ key: "entityId", expr: systemRef("entity", "id") }],
		},
	} satisfies JsonValue;
};

const collectionMembershipTarget = (automation: AutomationPolicyInput["automation"]) => {
	const draft = automation.source.draft;
	if (
		draft.entitySchemaSlug !== "collection" ||
		draft.eventSchemaSlug !== "add-entity-to-collection"
	) {
		return { entityId: draft.entityId, entitySchemaSlug: draft.entitySchemaSlug };
	}
	const entityId = draft.properties["entityId"];
	const entitySchemaSlug = draft.properties["entitySchemaSlug"];
	if (typeof entityId !== "string" || typeof entitySchemaSlug !== "string") {
		return null;
	}
	return eligibleEntitySchemaSlugs.has(entitySchemaSlug) ? { entityId, entitySchemaSlug } : null;
};

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const target = collectionMembershipTarget(automation);
			if (!target) {
				return { action: "allow" } as const;
			}
			const entityResponse = yield* host.executeQueryEngine(
				buildGlobalEntityQuery(target.entityId, target.entitySchemaSlug),
			);
			const entityId = queryFirstEntityId(entityResponse);
			if (!entityId) {
				return { action: "allow" } as const;
			}
			const libraryResponse = yield* host.executeQueryEngine(buildUserLibraryQuery());
			const libraryEntityId = queryFirstEntityId(libraryResponse);
			if (!libraryEntityId) {
				return yield* Effect.fail(new Error("Library entity not found for user"));
			}
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaSlug: "in-library",
						},
					],
				},
			]);
			return { action: "allow" } as const;
		}),
});
