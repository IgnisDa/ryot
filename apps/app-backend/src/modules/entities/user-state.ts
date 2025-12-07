import { checkReadAccess } from "~/lib/access";
import { type DbClient, db } from "~/lib/db";
import { serviceData, serviceError, type ServiceResult, wrapServiceValidator } from "~/lib/result";
import { deleteUserEventsForEntity } from "~/modules/events";

import { getEntityScopeForUser, deleteUserRelationshipsForEntity } from "./repository";
import { resolveEntityId } from "./service";

const entityNotFoundError = "Entity not found";
const libraryEntityUserStateError = "Library entity user state cannot be cleared";

type ClearEntityUserStateError = "not_found" | "validation";

export type ClearEntityUserStateData = {
	entityId: string;
	deletedEventsCount: number;
	deletedRelationshipsCount: number;
};

export type ClearEntityUserStateDeps = {
	getEntityScopeForUser: typeof getEntityScopeForUser;
	deleteUserEventsForEntity: typeof deleteUserEventsForEntity;
	deleteUserRelationshipsForEntity: typeof deleteUserRelationshipsForEntity;
	executeTransaction: <T>(callback: (tx: DbClient) => Promise<T>) => Promise<T>;
};

const clearEntityUserStateDeps: ClearEntityUserStateDeps = {
	getEntityScopeForUser,
	deleteUserEventsForEntity,
	deleteUserRelationshipsForEntity,
	executeTransaction: (callback) => db.transaction(callback),
};

const resolveEntityIdResult = (entityId: string) =>
	wrapServiceValidator(() => resolveEntityId(entityId), "Entity id is required");

export const clearEntityUserState = async (
	input: { userId: string; entityId: string },
	deps: ClearEntityUserStateDeps = clearEntityUserStateDeps,
): Promise<ServiceResult<ClearEntityUserStateData, ClearEntityUserStateError>> => {
	const entityIdResult = resolveEntityIdResult(input.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const entityResult = checkReadAccess(
		await deps.getEntityScopeForUser({ userId: input.userId, entityId: entityIdResult.data }),
		{ not_found: entityNotFoundError },
	);
	if ("error" in entityResult) {
		return serviceError("not_found", entityResult.message);
	}

	if (entityResult.data.entitySchemaSlug === "library") {
		return serviceError("validation", libraryEntityUserStateError);
	}

	const entityId = entityResult.data.entityId;
	let deletedEventsCount = 0;
	let deletedRelationshipsCount = 0;

	await deps.executeTransaction(async (tx) => {
		deletedEventsCount = await deps.deleteUserEventsForEntity({
			entityId,
			database: tx,
			userId: input.userId,
		});
		deletedRelationshipsCount = await deps.deleteUserRelationshipsForEntity(
			{ entityId, userId: input.userId },
			tx,
		);
	});

	return serviceData({ entityId, deletedEventsCount, deletedRelationshipsCount });
};
