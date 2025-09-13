import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";

import { deleteRelationship, upsertRelationship } from "./repository";

const memberOfRelationshipSchemaSlug = "member-of";
const memberOfRelationshipSchemaNotFoundError = "member-of relationship schema not found";

type CollectionMembershipRow = Awaited<ReturnType<typeof upsertRelationship>>;

type CollectionMembershipData = {
	memberOf: {
		id: string;
		createdAt: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	};
};

const toCollectionMembershipData = (row: CollectionMembershipRow): CollectionMembershipData => ({
	memberOf: { ...row, createdAt: row.createdAt.toISOString() },
});

export type WriteCollectionMembershipDeps = {
	upsertRelationship: typeof upsertRelationship;
	getBuiltinRelationshipSchemaBySlug: typeof getBuiltinRelationshipSchemaBySlug;
};

export type DeleteCollectionMembershipDeps = {
	deleteRelationship: typeof deleteRelationship;
	getBuiltinRelationshipSchemaBySlug: typeof getBuiltinRelationshipSchemaBySlug;
};

const writeCollectionMembershipDeps: WriteCollectionMembershipDeps = {
	upsertRelationship,
	getBuiltinRelationshipSchemaBySlug,
};

const deleteCollectionMembershipDeps: DeleteCollectionMembershipDeps = {
	deleteRelationship,
	getBuiltinRelationshipSchemaBySlug,
};

export const writeCollectionMembership = async (
	input: {
		userId: string;
		entityId: string;
		collectionId: string;
		properties: Record<string, unknown>;
	},
	deps: WriteCollectionMembershipDeps = writeCollectionMembershipDeps,
): Promise<ServiceResult<CollectionMembershipData, "not_found">> => {
	const memberOfSchema = await deps.getBuiltinRelationshipSchemaBySlug(
		memberOfRelationshipSchemaSlug,
	);
	if (!memberOfSchema) {
		return serviceError("not_found", memberOfRelationshipSchemaNotFoundError);
	}

	const membership = await deps.upsertRelationship({
		userId: input.userId,
		properties: input.properties,
		sourceEntityId: input.entityId,
		targetEntityId: input.collectionId,
		relationshipSchemaId: memberOfSchema.id,
	});

	return serviceData(toCollectionMembershipData(membership));
};

export const deleteCollectionMembership = async (
	input: { userId: string; entityId: string; collectionId: string },
	deps: DeleteCollectionMembershipDeps = deleteCollectionMembershipDeps,
): Promise<ServiceResult<CollectionMembershipData | undefined, "not_found">> => {
	const memberOfSchema = await deps.getBuiltinRelationshipSchemaBySlug(
		memberOfRelationshipSchemaSlug,
	);
	if (!memberOfSchema) {
		return serviceError("not_found", memberOfRelationshipSchemaNotFoundError);
	}

	const membership = await deps.deleteRelationship({
		userId: input.userId,
		sourceEntityId: input.entityId,
		targetEntityId: input.collectionId,
		relationshipSchemaId: memberOfSchema.id,
	});

	return serviceData(membership ? toCollectionMembershipData(membership) : undefined);
};
