import { defineAutomation, type AutomationInput } from "@ryot-app/plugin-backend-sdk/automation";
import {
	USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS,
	type ChangeUserRelationshipBatch,
} from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	executeRyotqlRecipe,
	inArray,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
	userMediaLibraryRecipe,
	type pluginId,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
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

type CreatedEventSnapshot = Extract<
	Extract<
		AutomationInput["automation"]["payload"],
		{ resource: "event"; operation: "batch" }
	>["items"][number],
	{ operation: "create" }
>["after"];

const isKernelCollectionMembershipEvent = (event: CreatedEventSnapshot) =>
	event.entitySchemaPluginId === null &&
	event.eventSchemaPluginId === null &&
	event.entitySchemaSlug === "collection" &&
	event.eventSchemaSlug === "add-entity-to-collection";

const ownMembershipTargetsRecipe = defineRecipe(
	(reference: Parameters<typeof pluginId>[0], entityIds: readonly string[]) => {
		const entity = table("entity", "membershipTarget");
		return {
			map: ({ targets }) => Result.succeed(targets.items),
			queries: {
				targets: selectedRows(entity, {
					limit: entityIds.length,
					orderBy: [ascending(column(entity, "id"))],
					selection: {
						entityId: selectedField(column(entity, "id"), Schema.String),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
					},
					where: and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
						inArray(
							column(entity, "id"),
							entityIds.map((entityId) => literal(entityId)),
						),
						inArray(
							column(entity, "entitySchemaSlug"),
							mediaLibraryMemberEntitySchemaSlugs.map((slug) => literal(slug)),
						),
					),
				}),
			},
		};
	},
);

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
			const target = isKernelCollectionMembershipEvent(event)
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
			if (
				payload.resource === "event" &&
				payload.operation === "batch" &&
				payload.items.some(
					(item) => item.operation === "create" && isKernelCollectionMembershipEvent(item.after),
				)
			) {
				const entityIds = [...targets.keys()];
				targets.clear();
				for (let index = 0; index < entityIds.length; index += 100) {
					const owned = yield* executeRyotqlRecipe(
						host.executeRyotql,
						ownMembershipTargetsRecipe({ kind: "self" }, entityIds.slice(index, index + 100)),
					);
					for (const target of owned) {
						targets.set(target.entityId, target);
					}
				}
				if (targets.size === 0) {
					return null;
				}
			}
			const mediaLibrary = yield* executeRyotqlRecipe(
				host.executeRyotql,
				userMediaLibraryRecipe({ kind: "self" }),
			);
			const creates = [...targets.values()].map<ChangeUserRelationshipBatch["creates"][number]>(
				(target) => ({
					properties: {},
					propertiesMode: "merge",
					sourceEntityId: target.entityId,
					targetEntityId: mediaLibrary.entityId,
					relationshipSchemaSlug: "in-media-library",
				}),
			);
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
