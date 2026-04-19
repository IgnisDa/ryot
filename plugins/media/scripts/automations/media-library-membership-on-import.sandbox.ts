import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { executeRyotqlRecipe, userLibraryRecipe } from "@ryot/sandbox-sdk/ryotql";

import { mediaLibraryEligibleEntitySchemaSlugs } from "../../schemas/media-schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media library membership on provider import",
	slug: "automation.media-library-membership-on-import",
	capabilities: ["executeRyotql", "changeUserRelationships"],
});

const eligibleEntitySchemaSlugs = new Set<string>(mediaLibraryEligibleEntitySchemaSlugs);

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			if (automation.source.kind !== "entity" || !automation.source.after) {
				return null;
			}
			const entity = automation.source.after;
			if (!eligibleEntitySchemaSlugs.has(entity.entitySchemaSlug)) {
				return null;
			}
			const library = yield* executeRyotqlRecipe(host.executeRyotql, userLibraryRecipe());
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: entity.id,
							targetEntityId: library.entityId,
							relationshipSchemaSlug: "in-library",
						},
					],
				},
			]);
			return null;
		}),
});
