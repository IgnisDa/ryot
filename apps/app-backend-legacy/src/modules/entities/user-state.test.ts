import { describe, expect, it } from "bun:test";

import type { DbClient } from "~/lib/db";
import { expectDataResult } from "~/lib/test-helpers";

import { clearEntityUserState, type ClearEntityUserStateDeps } from "./user-state";

type DeleteUserEventsInput = {
	userId: string;
	entityId: string;
	database?: DbClient;
};

type DeleteUserRelationshipsInput = {
	userId: string;
	entityId: string;
};

const createClearEntityUserStateDeps = (
	overrides: Partial<ClearEntityUserStateDeps> = {},
): ClearEntityUserStateDeps => ({
	deleteUserEventsForEntity: () => Promise.resolve(2),
	deleteUserRelationshipsForEntity: () => Promise.resolve(3),
	executeTransaction: async (callback) => {
		// oxlint-disable-next-line no-unsafe-type-assertion
		return callback({} as DbClient);
	},
	getEntityScopeForUser: (input) =>
		Promise.resolve({
			isBuiltin: false,
			entityId: input.entityId,
			entityUserId: input.userId,
			entitySchemaId: "schema_1",
			entitySchemaSlug: "custom",
		}),
	...overrides,
});

describe("clearEntityUserState", () => {
	it("returns validation when entity id is blank", async () => {
		const result = await clearEntityUserState(
			{ userId: "user_1", entityId: "   " },
			createClearEntityUserStateDeps(),
		);

		expect(result).toEqual({ error: "validation", message: "Entity id is required" });
	});

	it("returns not_found when the entity is not readable", async () => {
		const result = await clearEntityUserState(
			{ userId: "user_1", entityId: "entity_1" },
			createClearEntityUserStateDeps({
				getEntityScopeForUser: () => Promise.resolve(undefined),
			}),
		);

		expect(result).toEqual({ error: "not_found", message: "Entity not found" });
	});

	it("returns validation when targeting the library entity", async () => {
		const result = await clearEntityUserState(
			{ userId: "user_1", entityId: "entity_library" },
			createClearEntityUserStateDeps({
				getEntityScopeForUser: (input) =>
					Promise.resolve({
						isBuiltin: true,
						entityId: input.entityId,
						entityUserId: input.userId,
						entitySchemaSlug: "library",
						entitySchemaId: "schema_library",
					}),
			}),
		);

		expect(result).toEqual({
			error: "validation",
			message: "Library entity user state cannot be cleared",
		});
	});

	it("deletes user events and relationships in one transaction", async () => {
		let capturedRelationshipDb: DbClient | undefined;
		// oxlint-disable-next-line no-unsafe-type-assertion
		const transaction = { name: "tx" } as unknown as DbClient;
		let capturedEventInput: DeleteUserEventsInput | undefined;
		let capturedRelationshipInput: DeleteUserRelationshipsInput | undefined;

		const result = expectDataResult(
			await clearEntityUserState(
				{ userId: "user_1", entityId: "entity_1" },
				createClearEntityUserStateDeps({
					deleteUserEventsForEntity: (input) => {
						capturedEventInput = input;
						return Promise.resolve(4);
					},
					executeTransaction: async (callback) => {
						// oxlint-disable-next-line no-unsafe-type-assertion
						return callback(transaction);
					},
					deleteUserRelationshipsForEntity: (input, database) => {
						capturedRelationshipInput = input;
						capturedRelationshipDb = database;
						return Promise.resolve(5);
					},
				}),
			),
		);

		expect(capturedEventInput).toEqual({
			userId: "user_1",
			entityId: "entity_1",
			database: transaction,
		});
		expect(capturedRelationshipInput).toEqual({ userId: "user_1", entityId: "entity_1" });
		expect(capturedRelationshipDb).toBe(transaction);
		expect(result).toEqual({
			entityId: "entity_1",
			deletedEventsCount: 4,
			deletedRelationshipsCount: 5,
		});
	});
});
