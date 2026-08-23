import {
	defineAutomationPolicy,
	type AutomationPolicyInput,
} from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	isNull,
	literal,
	selectedField,
	selectedOptionalRow,
	executeRyotqlRecipe,
	table,
	userLibraryRecipe,
} from "@ryot-app/sandbox-sdk/ryotql";

import { mediaLibraryEligibleEntitySchemaSlugs } from "../contracts/schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media library membership policy",
	slug: "policy.media-library-membership",
	capabilities: ["executeRyotql", "changeUserRelationships"],
});

const eligibleEntitySchemaSlugs = new Set<string>(mediaLibraryEligibleEntitySchemaSlugs);

const globalEntityRecipe = defineRecipe((entityId: string, entitySchemaSlug: string) => {
	const entity = table("entity", "entity");
	return {
		queries: {
			entity: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					eq(column(entity, "id"), literal(entityId)),
					isNull(column(entity, "userId")),
					eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug)),
				),
				selection: { entityId: selectedField(column(entity, "id"), Schema.String) },
			}),
		},
		map: ({ entity: row }) => Result.succeed(row?.entityId ?? null),
	};
});

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
			const entityId = yield* executeRyotqlRecipe(
				host.executeRyotql,
				globalEntityRecipe(target.entityId, target.entitySchemaSlug),
			);
			if (!entityId) {
				return { action: "allow" } as const;
			}
			const library = yield* executeRyotqlRecipe(host.executeRyotql, userLibraryRecipe());
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: entityId,
							targetEntityId: library.entityId,
							relationshipSchemaSlug: "in-library",
						},
					],
				},
			]);
			return { action: "allow" } as const;
		}),
});
