import { describe, expect, it } from "bun:test";
import { upsertInLibraryRelationship } from "./repository";

describe("upsertInLibraryRelationship", () => {
	it("calls insert with the correct shape", async () => {
		const captured: unknown[] = [];

		await upsertInLibraryRelationship(
			{
				userId: "user_1",
				mediaEntityId: "entity_media_1",
				libraryEntityId: "entity_lib_1",
			},
			async (values) => {
				captured.push(values);
			},
		);

		expect(captured).toEqual([
			{
				properties: {},
				userId: "user_1",
				relType: "in_library",
				targetEntityId: "entity_lib_1",
				sourceEntityId: "entity_media_1",
			},
		]);
	});

	it("delegates to the insert function on each call, relying on onConflictDoNothing for DB-level idempotency", async () => {
		const insertCalls: unknown[] = [];
		const mockInsert = async (values: unknown) => {
			insertCalls.push(values);
		};
		const input = {
			userId: "user_1",
			mediaEntityId: "entity_media_1",
			libraryEntityId: "entity_lib_1",
		};

		await upsertInLibraryRelationship(input, mockInsert);
		await upsertInLibraryRelationship(input, mockInsert);

		expect(insertCalls).toHaveLength(2);
		expect(insertCalls[0]).toEqual(insertCalls[1]);
	});
});
