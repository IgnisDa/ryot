import { defineAutomationPolicy, type AutomationPolicyInput } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	isNull,
	literal,
	rows,
	table,
} from "@ryot/sandbox-sdk/ryotql";

import { buildUserLibraryDocument, decodeUserLibraryId } from "../../media-monitoring-ryotql";
import { mediaLibraryEligibleEntitySchemaSlugs } from "../../schemas/media-schema-slugs";
import { decodeEntityId } from "../../shared/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media library membership policy",
	slug: "policy.media-library-membership",
	capabilities: ["executeRyotql", "changeUserRelationships"],
});

const eligibleEntitySchemaSlugs = new Set<string>(mediaLibraryEligibleEntitySchemaSlugs);

const buildGlobalEntityQuery = (entityId: string, entitySchemaSlug: string) => {
	const entity = table("entity", "entity");
	return document({
		entity: rows(entity, {
			limit: 1,
			orderBy: [ascending(column(entity, "id"))],
			where: and(
				eq(column(entity, "id"), literal(entityId)),
				isNull(column(entity, "userId")),
				eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug)),
			),
			fields: [field("entityId", column(entity, "id"))],
		}),
	});
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
			const entityResponse = yield* host.executeRyotql(
				buildGlobalEntityQuery(target.entityId, target.entitySchemaSlug),
			);
			const entityId = decodeEntityId(entityResponse, "entity");
			if (!entityId) {
				return { action: "allow" } as const;
			}
			const libraryResponse = yield* host.executeRyotql(buildUserLibraryDocument());
			const libraryEntityId = decodeUserLibraryId(libraryResponse);
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
