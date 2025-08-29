import { faker } from "@faker-js/faker";
import {
	EntityLot,
	MediaCollectionPresenceFilter,
	MediaCollectionStrategyFilter,
	UserMetadataListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	addEntitiesToCollection,
	createCollection,
	getGraphqlClient,
	registerTestUser,
	searchAudibleAudiobook,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

const COLLECTION_NAMES = {
	NEW_RELEASES: "New Releases",
	AWARD_WINNERS: "Award Winners",
	SCI_FI_CLASSICS: "Sci-Fi Classics",
	BEST_OF_THE_BEST: "Best of the Best",
	HORROR_COLLECTION: "Horror Collection",
	FANTASY_AUDIOBOOKS: "Fantasy Audiobooks",
	MYSTERY_COLLECTION: "Mystery Collection",
} as const;

describe("Collection Filters Tests", () => {
	const url = process.env.API_BASE_URL as string;
	let userId: string;
	let userApiKey: string;

	let duneId: string;
	let hobbitId: string;
	let endersGameId: string;
	let foundationId: string;
	let harryPotterId: string;
	let frankensteinId: string;
	let prideAndPrejudiceId: string;
	let nineteenEightyFourId: string;

	let newReleasesId: string;
	let awardWinnersId: string;
	let sciFiCollectionId: string;
	let bestOfCollectionId: string;
	let horrorCollectionId: string;
	let fantasyCollectionId: string;
	let mysteryCollectionId: string;

	beforeAll(async () => {
		[userApiKey, userId] = await registerTestUser(url);

		const fantasyCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.FANTASY_AUDIOBOOKS,
		);
		fantasyCollectionId = fantasyCollection.id;

		const sciFiCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.SCI_FI_CLASSICS,
		);
		sciFiCollectionId = sciFiCollection.id;

		const bestOfCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.BEST_OF_THE_BEST,
		);
		bestOfCollectionId = bestOfCollection.id;

		const horrorCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.HORROR_COLLECTION,
		);
		horrorCollectionId = horrorCollection.id;

		const mysteryCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.MYSTERY_COLLECTION,
		);
		mysteryCollectionId = mysteryCollection.id;

		const awardWinnersCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.AWARD_WINNERS,
		);
		awardWinnersId = awardWinnersCollection.id;

		const newReleasesCollection = await createCollection(
			url,
			userApiKey,
			COLLECTION_NAMES.NEW_RELEASES,
		);
		newReleasesId = newReleasesCollection.id;

		const harryPotterResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Harry Potter and the Philosopher's Stone",
		);
		expect(harryPotterResults.length).toBeGreaterThan(0);
		harryPotterId = harryPotterResults[0];

		const foundationResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Foundation Isaac Asimov",
		);
		expect(foundationResults.length).toBeGreaterThan(0);
		foundationId = foundationResults[0];

		const duneResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Dune Frank Herbert",
		);
		expect(duneResults.length).toBeGreaterThan(0);
		duneId = duneResults[0];

		const hobbitResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"The Hobbit Tolkien",
		);
		expect(hobbitResults.length).toBeGreaterThan(0);
		hobbitId = hobbitResults[0];

		const frankensteinResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Frankenstein Mary Shelley",
		);
		expect(frankensteinResults.length).toBeGreaterThan(0);
		frankensteinId = frankensteinResults[0];

		const prideAndPrejudiceResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Pride and Prejudice Jane Austen",
		);
		expect(prideAndPrejudiceResults.length).toBeGreaterThan(0);
		prideAndPrejudiceId = prideAndPrejudiceResults[0];

		const nineteenEightyFourResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"1984 George Orwell",
		);
		expect(nineteenEightyFourResults.length).toBeGreaterThan(0);
		nineteenEightyFourId = nineteenEightyFourResults[0];

		const endersGameResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Ender's Game Orson Scott Card",
		);
		expect(endersGameResults.length).toBeGreaterThan(0);
		endersGameId = endersGameResults[0];

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.FANTASY_AUDIOBOOKS,
			[
				{ entityId: hobbitId, entityLot: EntityLot.Metadata },
				{ entityId: nineteenEightyFourId, entityLot: EntityLot.Metadata },
				{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
			],
		);

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.SCI_FI_CLASSICS,
			[
				{ entityId: duneId, entityLot: EntityLot.Metadata },
				{ entityId: endersGameId, entityLot: EntityLot.Metadata },
				{ entityId: foundationId, entityLot: EntityLot.Metadata },
			],
		);

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.BEST_OF_THE_BEST,
			[
				{ entityId: duneId, entityLot: EntityLot.Metadata },
				{ entityId: foundationId, entityLot: EntityLot.Metadata },
				{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
				{ entityId: prideAndPrejudiceId, entityLot: EntityLot.Metadata },
			],
		);

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.HORROR_COLLECTION,
			[
				{ entityId: frankensteinId, entityLot: EntityLot.Metadata },
				{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
			],
		);

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.MYSTERY_COLLECTION,
			[
				{ entityId: frankensteinId, entityLot: EntityLot.Metadata },
				{ entityId: prideAndPrejudiceId, entityLot: EntityLot.Metadata },
			],
		);

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.AWARD_WINNERS,
			[
				{ entityId: duneId, entityLot: EntityLot.Metadata },
				{ entityId: hobbitId, entityLot: EntityLot.Metadata },
				{ entityId: foundationId, entityLot: EntityLot.Metadata },
				{ entityId: prideAndPrejudiceId, entityLot: EntityLot.Metadata },
			],
		);

		await addEntitiesToCollection(
			url,
			userApiKey,
			userId,
			COLLECTION_NAMES.NEW_RELEASES,
			[
				{ entityId: endersGameId, entityLot: EntityLot.Metadata },
				{ entityId: nineteenEightyFourId, entityLot: EntityLot.Metadata },
			],
		);
	});

	const getAuthHeaders = () => ({
		Authorization: `Bearer ${userApiKey}`,
	});

	it("should filter audiobooks present in Fantasy collection", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(3);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(nineteenEightyFourId);
	});

	it("should filter audiobooks NOT present in Fantasy collection", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toHaveLength(5);

		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(hobbitId);
		expect(items).not.toContain(nineteenEightyFourId);

		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(endersGameId);
		expect(items).toContain(frankensteinId);
		expect(items).toContain(prideAndPrejudiceId);

		const expectedIds = [
			duneId,
			foundationId,
			endersGameId,
			frankensteinId,
			prideAndPrejudiceId,
		];
		const sortedItems = [...items].sort();
		const sortedExpected = [...expectedIds].sort();
		expect(sortedItems).toEqual(sortedExpected);
	});

	it("should use OR strategy to get audiobooks from Fantasy OR Sci-Fi collections", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: sciFiCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(6);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(nineteenEightyFourId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(endersGameId);
	});

	it("should use AND strategy to get audiobooks in BOTH Fantasy AND Best Of collections", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: bestOfCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(1);
		expect(items).toContain(harryPotterId);
	});

	it("should handle mixed strategies: present in Fantasy OR Sci-Fi OR Best Of", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: sciFiCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: bestOfCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(7);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(nineteenEightyFourId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(endersGameId);
		expect(items).toContain(prideAndPrejudiceId);
	});

	it("should handle complex NOT present scenario: NOT in Fantasy AND NOT in Sci-Fi", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
							{
								collectionId: sciFiCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(hobbitId);
		expect(items).not.toContain(nineteenEightyFourId);
		expect(items).not.toContain(foundationId);
		expect(items).not.toContain(duneId);
		expect(items).not.toContain(endersGameId);
		expect(items).toContain(frankensteinId);
		expect(items).toContain(prideAndPrejudiceId);
	});

	it("should return all audiobooks when no collection filters applied", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: { filter: {} } },
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(8);
	});

	it("should handle empty collection filters array", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: { filter: { collections: [] } } },
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(8);
	});

	it("should handle non-existent collection ID gracefully", async () => {
		const client = getGraphqlClient(url);
		const nonExistentCollectionId = faker.string.uuid();

		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: nonExistentCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toHaveLength(0);
	});

	it("should handle multiple filters with same collection but different presence", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBeGreaterThanOrEqual(8);
	});

	it("should handle chain of AND operations: Fantasy AND Award Winners", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: awardWinnersId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toContain(hobbitId);
		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(nineteenEightyFourId);
	});

	it("should handle complex 4-collection filter: Horror AND Mystery OR Award Winners OR New Releases", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: horrorCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: mysteryCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: awardWinnersId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: newReleasesId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toContain(frankensteinId);
		expect(items).toContain(duneId);
		expect(items).toContain(foundationId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(prideAndPrejudiceId);
		expect(items).toContain(nineteenEightyFourId);
		expect(items).toContain(endersGameId);
		expect(items.length).toBe(7);
	});

	it("should filter items present in exactly 2 collections: Best Of AND Award Winners", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: bestOfCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: awardWinnersId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(prideAndPrejudiceId);
		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(hobbitId);
		expect(items.length).toBe(3);
	});

	it("should handle mixed NOT present operations: NOT in Horror AND NOT in Mystery", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: horrorCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
							{
								collectionId: mysteryCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBe(5);
		expect(items).toContain(hobbitId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(nineteenEightyFourId);
		expect(items).toContain(endersGameId);
		expect(items).not.toContain(frankensteinId);
		expect(items).not.toContain(prideAndPrejudiceId);
		expect(items).not.toContain(harryPotterId);
	});

	it("should test complex additive union: Fantasy OR Horror OR Mystery OR New Releases", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: horrorCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: mysteryCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: newReleasesId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(nineteenEightyFourId);
		expect(items).toContain(frankensteinId);
		expect(items).toContain(prideAndPrejudiceId);
		expect(items).toContain(endersGameId);
		expect(items.length).toBe(6);
	});

	it("should handle 5-collection complex filter with mixed strategies", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: sciFiCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: bestOfCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: horrorCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
							{
								collectionId: mysteryCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.NotPresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toContain(hobbitId);
		expect(items).toContain(nineteenEightyFourId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(endersGameId);
		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(frankensteinId);
		expect(items).not.toContain(prideAndPrejudiceId);
		expect(items.length).toBe(5);
	});

	it("should validate empty intersection scenario: Sci-Fi AND Fantasy", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: sciFiCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toHaveLength(0);
	});

	it("should test maximum collection overlap scenario: Award Winners", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: awardWinnersId,
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						],
					},
				},
			},
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items).toContain(duneId);
		expect(items).toContain(foundationId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(prideAndPrejudiceId);
		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(frankensteinId);
		expect(items).not.toContain(nineteenEightyFourId);
		expect(items).not.toContain(endersGameId);
		expect(items.length).toBe(4);
	});
});
