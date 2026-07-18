import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe, userLibraryRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { mediaLibraryEligibleEntitySchemaSlugs } from "../contracts/schema-slugs";

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
			if (automation.source.kind !== "provider-entity-import") {
				return null;
			}
			if (!eligibleEntitySchemaSlugs.has(automation.source.entitySchemaSlug)) {
				return null;
			}
			const library = yield* executeRyotqlRecipe(host.executeRyotql, userLibraryRecipe());
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							targetEntityId: library.entityId,
							relationshipSchemaSlug: "in-library",
							sourceEntityId: automation.source.entityId,
						},
					],
				},
			]);
			return null;
		}),
});
