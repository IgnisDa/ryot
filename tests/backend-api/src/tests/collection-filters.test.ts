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
	SCI_FI_CLASSICS: "Sci-Fi Classics",
	BEST_OF_THE_BEST: "Best of the Best",
	FANTASY_AUDIOBOOKS: "Fantasy Audiobooks",
} as const;

describe("Collection Filters Tests", () => {
	const url = process.env.API_BASE_URL as string;
	let userId: string;
	let userApiKey: string;

	let sciFiCollectionId: string;
	let bestOfCollectionId: string;
	let fantasyCollectionId: string;

	let duneId: string;
	let hobbitId: string;
	let foundationId: string;
	let harryPotterId: string;

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

		await client.request(
			DeployAddEntitiesToCollectionJobDocument,
			{
				input: {
					creatorUserId: userId,
					collectionName: COLLECTION_NAMES.FANTASY_AUDIOBOOKS,
					entities: [
						{ entityId: hobbitId, entityLot: EntityLot.Metadata },
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
						{ entityId: foundationId, entityLot: EntityLot.Metadata },
						{ entityId: harryPotterId, entityLot: EntityLot.Metadata },
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

		expect(items.length).toBeGreaterThanOrEqual(2);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
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

		expect(items).not.toContain(harryPotterId);
		expect(items).not.toContain(hobbitId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
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
								strategy: MediaCollectionStrategyFilter.Or,
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

		expect(items.length).toBeGreaterThanOrEqual(4);
		expect(items).toContain(harryPotterId);
		expect(items).toContain(hobbitId);
		expect(items).toContain(foundationId);
		expect(items).toContain(duneId);
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
		expect(items).not.toContain(foundationId);
		expect(items).not.toContain(duneId);
	});

	it("should handle mixed strategies: present in Fantasy OR (present in Sci-Fi AND Best Of)", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{
				input: {
					filter: {
						collections: [
							{
								collectionId: fantasyCollectionId,
								strategy: MediaCollectionStrategyFilter.Or,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
							{
								collectionId: sciFiCollectionId,
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
		expect(items).toContain(hobbitId);
		expect(items).toContain(foundationId);
		expect(items).not.toContain(duneId);
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
		expect(items).not.toContain(foundationId);
		expect(items).not.toContain(duneId);
	});

	it("should return all audiobooks when no collection filters applied", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: { filter: {} } },
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBeGreaterThanOrEqual(4);
	});

	it("should handle empty collection filters array", async () => {
		const client = getGraphqlClient(url);
		const { userMetadataList } = await client.request(
			UserMetadataListDocument,
			{ input: { filter: { collections: [] } } },
			getAuthHeaders(),
		);

		const items = userMetadataList.response.items;

		expect(items.length).toBeGreaterThanOrEqual(4);
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
								strategy: MediaCollectionStrategyFilter.Or,
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

		expect(items.length).toBeGreaterThanOrEqual(4);
	});
});
