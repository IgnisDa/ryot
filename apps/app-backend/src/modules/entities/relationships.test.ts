import { describe, expect, it } from "bun:test";

import { expectDataResult } from "~/lib/test-helpers";

import { deleteCollectionMembership, writeCollectionMembership } from "./relationships";

type WriteCollectionMembershipTestDeps = NonNullable<
	Parameters<typeof writeCollectionMembership>[1]
>;
type DeleteCollectionMembershipTestDeps = NonNullable<
	Parameters<typeof deleteCollectionMembership>[1]
>;

describe("writeCollectionMembership", () => {
	it("upserts the member-of relationship and returns membership data", async () => {
		let relationshipInput:
			| Parameters<WriteCollectionMembershipTestDeps["upsertRelationship"]>[0]
			| undefined;

		const result = expectDataResult(
			await writeCollectionMembership(
				{
					userId: "user_1",
					entityId: "entity_1",
					collectionId: "collection_1",
					properties: { priority: "high" },
				},
				{
					getBuiltinRelationshipSchemaBySlug: () =>
						Promise.resolve({ id: "rel_schema_member_of", propertiesSchema: { fields: {} } }),
					upsertRelationship: (input) => {
						relationshipInput = input;
						return Promise.resolve({
							id: "rel_1",
							wasInserted: true,
							createdAt: new Date("2024-01-01T00:00:00.000Z"),
							properties: input.properties,
							sourceEntityId: input.sourceEntityId,
							targetEntityId: input.targetEntityId,
							relationshipSchemaId: input.relationshipSchemaId,
						});
					},
				},
			),
		);

		expect(relationshipInput).toEqual({
			userId: "user_1",
			properties: { priority: "high" },
			sourceEntityId: "entity_1",
			targetEntityId: "collection_1",
			relationshipSchemaId: "rel_schema_member_of",
		});
		expect(result.wasInserted).toBe(true);
		expect(result.memberOf).toEqual({
			id: "rel_1",
			sourceEntityId: "entity_1",
			targetEntityId: "collection_1",
			properties: { priority: "high" },
			createdAt: "2024-01-01T00:00:00.000Z",
			relationshipSchemaId: "rel_schema_member_of",
		});
	});

	it("returns not_found when the member-of schema is missing", async () => {
		let writeCalls = 0;

		const result = await writeCollectionMembership(
			{ userId: "user_1", entityId: "entity_1", collectionId: "collection_1", properties: {} },
			{
				getBuiltinRelationshipSchemaBySlug: () => Promise.resolve(undefined),
				// oxlint-disable-next-line no-unsafe-type-assertion
				upsertRelationship: (() => {
					writeCalls++;
					throw new Error("Should not write without schema");
				}) as never,
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "member-of relationship schema not found",
		});
		expect(writeCalls).toBe(0);
	});
});

describe("deleteCollectionMembership", () => {
	it("deletes the member-of relationship and returns membership data", async () => {
		let relationshipInput:
			| Parameters<DeleteCollectionMembershipTestDeps["deleteRelationship"]>[0]
			| undefined;

		const result = expectDataResult(
			await deleteCollectionMembership(
				{ userId: "user_1", entityId: "entity_1", collectionId: "collection_1" },
				{
					getBuiltinRelationshipSchemaBySlug: () =>
						Promise.resolve({ id: "rel_schema_member_of", propertiesSchema: { fields: {} } }),
					deleteRelationship: (input) => {
						relationshipInput = input;
						return Promise.resolve({
							id: "rel_1",
							properties: {},
							createdAt: new Date("2024-01-01T00:00:00.000Z"),
							sourceEntityId: input.sourceEntityId,
							targetEntityId: input.targetEntityId,
							relationshipSchemaId: input.relationshipSchemaId,
						});
					},
				},
			),
		);

		expect(relationshipInput).toEqual({
			userId: "user_1",
			sourceEntityId: "entity_1",
			targetEntityId: "collection_1",
			relationshipSchemaId: "rel_schema_member_of",
		});
		expect(result).toBeDefined();
		expect(result?.memberOf.id).toBe("rel_1");
		expect(result?.memberOf.createdAt).toBe("2024-01-01T00:00:00.000Z");
	});

	it("returns undefined data when no membership exists", async () => {
		const result = expectDataResult(
			await deleteCollectionMembership(
				{ userId: "user_1", entityId: "entity_1", collectionId: "collection_1" },
				{
					deleteRelationship: () => Promise.resolve(undefined),
					getBuiltinRelationshipSchemaBySlug: () =>
						Promise.resolve({ id: "rel_schema_member_of", propertiesSchema: { fields: {} } }),
				},
			),
		);

		expect(result).toBeUndefined();
	});

	it("returns not_found when the member-of schema is missing", async () => {
		let deleteCalls = 0;

		const result = await deleteCollectionMembership(
			{ userId: "user_1", entityId: "entity_1", collectionId: "collection_1" },
			{
				getBuiltinRelationshipSchemaBySlug: () => Promise.resolve(undefined),
				deleteRelationship: () => {
					deleteCalls++;
					throw new Error("Should not delete without schema");
				},
			},
		);

		expect(result).toEqual({
			error: "not_found",
			message: "member-of relationship schema not found",
		});
		expect(deleteCalls).toBe(0);
	});
});
