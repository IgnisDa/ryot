import { defineAutomationPolicy } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import { buildUserLibraryQuery, queryFirstEntityId } from "../../media-monitoring";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media library membership policy",
	slug: "policy.media-library-membership",
	capabilities: ["executeQueryEngine", "changeUserRelationships"],
});

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

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const draft = automation.source.draft;
			const entityResponse = yield* host.executeQueryEngine(
				buildGlobalEntityQuery(draft.entityId, draft.entitySchemaSlug),
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
