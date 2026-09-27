import { defineAutomation, type AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { mediaLibraryMemberEntitySchemaSlugs } from "../contracts/schema-slugs";
import { MediaSandboxError } from "../lib/failures";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Ensure media library membership",
	slug: "automation.ensure-media-library-membership",
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

const mediaLibraryTargets = (
	payload: AutomationInput["automation"]["payload"],
): MediaLibraryTarget[] => {
	if (payload.resource === "provider-entity-import") {
		return [{ entityId: payload.entityId, entitySchemaSlug: payload.entitySchemaSlug }];
	}
	if (payload.resource === "entity" && payload.operation === "create" && "after" in payload) {
		return [{ entityId: payload.after.id, entitySchemaSlug: payload.after.entitySchemaSlug }];
	}
	if (payload.resource === "event" && payload.operation === "batch") {
		return payload.items.flatMap((item) => {
			if (item.operation !== "create" || item.after.eventSchemaSlug === "add-to-media-library") {
				return [];
			}
			const event = item.after;
			const target =
				event.entitySchemaSlug === "collection" &&
				event.eventSchemaSlug === "add-entity-to-collection"
					? collectionMembershipTarget(event)
					: { entityId: event.entityId, entitySchemaSlug: event.entitySchemaSlug };
			return target ? [target] : [];
		});
	}
	return [];
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
				return yield* new MediaSandboxError({
					message: "Provider import user does not match execution user",
				});
			}
			const targets = new Map<string, MediaLibraryTarget>();
			for (const target of mediaLibraryTargets(payload)) {
				if (libraryMemberEntitySchemaSlugs.has(target.entitySchemaSlug)) {
					targets.set(target.entityId, target);
				}
			}
			if (targets.size === 0) {
				return null;
			}
			const mediaLibrary = yield* executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe());
			const creates = [...targets.values()].map((target) => ({
				properties: {},
				sourceEntityId: target.entityId,
				targetEntityId: mediaLibrary.entityId,
				relationshipSchemaSlug: "in-media-library",
			}));
			const batches = [];
			for (
				let index = 0;
				index < creates.length;
				index += USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.changesPerBatch
			) {
				batches.push({
					deletes: [],
					creates: creates.slice(
						index,
						index + USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.changesPerBatch,
					),
				});
			}
			yield* host.changeUserRelationships(batches);
			return null;
		}),
});
