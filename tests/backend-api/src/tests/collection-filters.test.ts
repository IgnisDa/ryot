import { faker } from "@faker-js/faker";
import {
	CreateOrUpdateCollectionDocument,
	DeployAddEntitiesToCollectionJobDocument,
	EntityLot,
	MediaCollectionPresenceFilter,
	MediaCollectionStrategyFilter,
	UserMetadataListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	registerTestUser,
	searchAudibleAudiobook,
	waitFor,
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
	let robotsId: string;
	let hobbitId: string;
	let foundationId: string;
	let stormLightId: string;
	let theShiningId: string;
	let harryPotterId: string;
	let orientExpressId: string;

	let newReleasesId: string;
	let awardWinnersId: string;
	let sciFiCollectionId: string;
	let bestOfCollectionId: string;
	let horrorCollectionId: string;
	let fantasyCollectionId: string;
	let mysteryCollectionId: string;

	beforeAll(async () => {
		[userApiKey, userId] = await registerTestUser(url);
		const client = getGraphqlClient(url);

		const { createOrUpdateCollection: fantasyCollection } =
			await client.request(
				CreateOrUpdateCollectionDocument,
				{ input: { name: COLLECTION_NAMES.FANTASY_AUDIOBOOKS } },
				{ Authorization: `Bearer ${userApiKey}` },
			);
		fantasyCollectionId = fantasyCollection.id;

		const { createOrUpdateCollection: sciFiCollection } = await client.request(
			CreateOrUpdateCollectionDocument,
			{ input: { name: COLLECTION_NAMES.SCI_FI_CLASSICS } },
			{ Authorization: `Bearer ${userApiKey}` },
		);
		sciFiCollectionId = sciFiCollection.id;

		const { createOrUpdateCollection: bestOfCollection } = await client.request(
			CreateOrUpdateCollectionDocument,
			{ input: { name: COLLECTION_NAMES.BEST_OF_THE_BEST } },
			{ Authorization: `Bearer ${userApiKey}` },
		);
		bestOfCollectionId = bestOfCollection.id;

		const { createOrUpdateCollection: horrorCollection } = await client.request(
			CreateOrUpdateCollectionDocument,
			{ input: { name: COLLECTION_NAMES.HORROR_COLLECTION } },
			{ Authorization: `Bearer ${userApiKey}` },
		);
		horrorCollectionId = horrorCollection.id;

		const { createOrUpdateCollection: mysteryCollection } =
			await client.request(
				CreateOrUpdateCollectionDocument,
				{ input: { name: COLLECTION_NAMES.MYSTERY_COLLECTION } },
				{ Authorization: `Bearer ${userApiKey}` },
			);
		mysteryCollectionId = mysteryCollection.id;

		const { createOrUpdateCollection: awardWinnersCollection } =
			await client.request(
				CreateOrUpdateCollectionDocument,
				{ input: { name: COLLECTION_NAMES.AWARD_WINNERS } },
				{ Authorization: `Bearer ${userApiKey}` },
			);
		awardWinnersId = awardWinnersCollection.id;

		const { createOrUpdateCollection: newReleasesCollection } =
			await client.request(
				CreateOrUpdateCollectionDocument,
				{ input: { name: COLLECTION_NAMES.NEW_RELEASES } },
				{ Authorization: `Bearer ${userApiKey}` },
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

		const theShiningResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Frankenstein Mary Shelley",
		);
		expect(theShiningResults.length).toBeGreaterThan(0);
		theShiningId = theShiningResults[0];

		const orientExpressResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Pride and Prejudice Jane Austen",
		);
		expect(orientExpressResults.length).toBeGreaterThan(0);
		orientExpressId = orientExpressResults[0];

		const stormLightResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"1984 George Orwell",
		);
		expect(stormLightResults.length).toBeGreaterThan(0);
		stormLightId = stormLightResults[0];

		const robotsResults = await searchAudibleAudiobook(
			url,
			userApiKey,
			"Ender's Game Orson Scott Card",
		);
		expect(robotsResults.length).toBeGreaterThan(0);
		robotsId = robotsResults[0];

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.FANTASY_AUDIOBOOKS,
					entities: [
						{ entityId: hobbitId, entityLot: EntityLot.Metadata },
						{ entityId: stormLightId, entityLot: EntityLot.Metadata },
						{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.SCI_FI_CLASSICS,
					entities: [
						{ entityId: duneId, entityLot: EntityLot.Metadata },
						{ entityId: robotsId, entityLot: EntityLot.Metadata },
						{ entityId: foundationId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.BEST_OF_THE_BEST,
					entities: [
						{ entityId: duneId, entityLot: EntityLot.Metadata },
						{ entityId: foundationId, entityLot: EntityLot.Metadata },
						{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
						{ entityId: orientExpressId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.HORROR_COLLECTION,
					entities: [
						{ entityId: theShiningId, entityLot: EntityLot.Metadata },
						{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.MYSTERY_COLLECTION,
					entities: [
						{ entityId: theShiningId, entityLot: EntityLot.Metadata },
						{ entityId: orientExpressId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.AWARD_WINNERS,
					entities: [
						{ entityId: duneId, entityLot: EntityLot.Metadata },
						{ entityId: hobbitId, entityLot: EntityLot.Metadata },
						{ entityId: foundationId, entityLot: EntityLot.Metadata },
						{ entityId: orientExpressId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.NEW_RELEASES,
					entities: [
						{ entityId: robotsId, entityLot: EntityLot.Metadata },
						{ entityId: stormLightId, entityLot: EntityLot.Metadata },
					],
				},
			},
			{ Authorization: `Bearer ${userApiKey}` },
		);

		await waitFor(4000);
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

		expect(items.length).toBeGreaterThanOrEqual(3);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(stormLightId);
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

		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(hobbitId);
		expect(items).not.toContain(stormLightId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(robotsId);
		expect(items).toContain(theShiningId);
		expect(items).toContain(orientExpressId);
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

		expect(items.length).toBeGreaterThanOrEqual(6);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(stormLightId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(robotsId);
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

		expect(items).toContain(harryPotterId);
		expect(items).not.toContain(hobbitId);
		expect(items).not.toContain(stormLightId);
		expect(items).not.toContain(foundationId);
		expect(items).not.toContain(duneId);
		expect(items).not.toContain(orientExpressId);
		expect(items).not.toContain(robotsId);
		expect(items).not.toContain(theShiningId);
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

		expect(items.length).toBeGreaterThanOrEqual(7);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(stormLightId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(robotsId);
		expect(items).toContain(orientExpressId);
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
		expect(items).not.toContain(stormLightId);
		expect(items).not.toContain(foundationId);
		expect(items).not.toContain(duneId);
		expect(items).not.toContain(robotsId);
		expect(items).toContain(theShiningId);
		expect(items).toContain(orientExpressId);
	});

	it("should return all audiobooks when no collection filters applied", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: { filter: {} } },
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBeGreaterThanOrEqual(8);
	});

	it("should handle empty collection filters array", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: { filter: { collections: [] } } },
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBeGreaterThanOrEqual(8);
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
		expect(items).not.toContain(stormLightId);
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

		expect(items).toContain(theShiningId);
		expect(items).toContain(duneId);
		expect(items).toContain(foundationId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(orientExpressId);
		expect(items).toContain(stormLightId);
		expect(items).toContain(robotsId);
		expect(items.length).toBeGreaterThanOrEqual(7);
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
		expect(items).toContain(orientExpressId);
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

		expect(items).toContain(hobbitId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(stormLightId);
		expect(items).toContain(robotsId);
		expect(items).not.toContain(theShiningId);
		expect(items).not.toContain(orientExpressId);
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
		expect(items).toContain(stormLightId);
		expect(items).toContain(theShiningId);
		expect(items).toContain(orientExpressId);
		expect(items).toContain(robotsId);
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
		expect(items).toContain(stormLightId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
		expect(items).toContain(robotsId);
		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(theShiningId);
		expect(items).not.toContain(orientExpressId);
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
		expect(items).toContain(orientExpressId);
		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(theShiningId);
		expect(items).not.toContain(stormLightId);
		expect(items).not.toContain(robotsId);
		expect(items.length).toBe(4);
	});
});
