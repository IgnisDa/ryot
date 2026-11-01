import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

export const EntityReferenceSnapshot = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type EntityReferenceSnapshot = typeof EntityReferenceSnapshot.Type;

export const EntitySnapshotResult = Schema.Struct({ entity: ListedEntity });
export type EntitySnapshotResult = typeof EntitySnapshotResult.Type;
export const EntityDeleteResult = Schema.Null;
export const EntityEnsureResult = Schema.Struct({
	entityId: EntityId,
	wasInserted: Schema.Boolean,
});

export const projectEntityIngestionReceipt = (commandKind: string, result: unknown) => {
	if (!["entity:create", "entity:update", "entity:reference"].includes(commandKind)) {
		return Effect.succeed(null);
	}
	let outcome: "created" | "updated" | "unchanged" = "unchanged";
	if (commandKind === "entity:create") {
		outcome = "created";
	}
	if (commandKind === "entity:update") {
		outcome = "updated";
	}
	return Schema.decodeUnknownEffect(EntitySnapshotResult)(result).pipe(Effect.as(outcome));
};
