import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getFirstProviderScriptId,
	getSavedView,
	insertLibraryMembership,
	requireQueryEngineFieldValue,
	seedMediaEntity,
} from "../fixtures";

describe("saved views execution", () => {
	it("executes a built-in all-shows view with per-user isolation", async () => {
		const userA = await createAuthenticatedClient();
		const userB = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(userA.client, "show");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			entitySchemaId: schema.id,
			sandboxScriptId: getFirstProviderScriptId(schema),
			name: `Isolated All Shows ${crypto.randomUUID()}`,
			externalId: `isolated-all-shows-${crypto.randomUUID()}`,
			properties: {
				genres: [],
				images: [],
				isNsfw: null,
				sourceUrl: null,
				totalSeasons: 0,
				totalEpisodes: 0,
				description: null,
				publishYear: 2019,
				providerRating: 91.4,
				unlinkedCreators: [],
				productionStatus: "Ended",
			},
		});

		await insertLibraryMembership(userA.client, {
			userId: userA.userId,
			mediaEntityId: entity.id,
		});

		const userAView = await getSavedView(userA.client, "all-shows");
		const userBView = await getSavedView(userB.client, "all-shows");
		const userAResult = await executeQueryEngine(userA.client, userAView.queryDocument);
		const userBResult = await executeQueryEngine(userB.client, userBView.queryDocument);

		expect(
			userAResult.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value),
		).toContain(entity.name);
		expect(userBResult.data.items).toHaveLength(0);
	});

	it("keeps built-in media saved views executable after refetching their definitions", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "show");

		const entity = await seedMediaEntity({
			image: null,
			userId: null,
			entitySchemaId: schema.id,
			sandboxScriptId: getFirstProviderScriptId(schema),
			name: `Refetched All Shows ${crypto.randomUUID()}`,
			externalId: `refetched-all-shows-${crypto.randomUUID()}`,
			properties: {
				genres: [],
				images: [],
				isNsfw: null,
				sourceUrl: null,
				totalSeasons: 0,
				totalEpisodes: 0,
				description: null,
				publishYear: 2020,
				providerRating: 88.5,
				unlinkedCreators: [],
				productionStatus: "Returning Series",
			},
		});

		await insertLibraryMembership(client, { userId, mediaEntityId: entity.id });

		await getSavedView(client, "all-shows");
		const refetchedView = await getSavedView(client, "all-shows");
		const result = await executeQueryEngine(client, refetchedView.queryDocument);

		expect(
			result.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value),
		).toContain(entity.name);
	});
});
