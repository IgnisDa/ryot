import { faker } from "@faker-js/faker";
import {
	CollectionContentsDocument,
	CreateAccessLinkDocument,
	CreateOrUpdateCollectionDocument,
	DeployRemoveEntitiesFromCollectionJobDocument,
	EntityLot,
	ExpireCacheKeyDocument,
	RevokeAccessLinkDocument,
	UserAccessLinksDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	addEntitiesToCollection,
	createCollection,
	getFirstExerciseId,
	getGraphqlClient,
	registerTestUser,
	waitFor,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

describe("Collection and access link authorization regressions", () => {
	const url = process.env.API_BASE_URL as string;
	const client = getGraphqlClient(url);
	let ownerKey: string;
	let ownerId: string;
	let attackerKey: string;
	let collectionName: string;
	let collectionId: string;
	let exerciseId: string;

	const headers = (key: string) => ({ Authorization: `Bearer ${key}` });

	const getCollectionContents = async (
		_url: string,
		key: string,
		id: string,
	) => {
		const { collectionContents } = await client.request(
			CollectionContentsDocument,
			{ input: { collectionId: id } },
			headers(key),
		);
		await client.request(
			ExpireCacheKeyDocument,
			{ cacheId: collectionContents.cacheId },
			headers(key),
		);
		return collectionContents.response.results.items;
	};

	beforeAll(async () => {
		[ownerKey, ownerId] = await registerTestUser(url);
		[attackerKey] = await registerTestUser(url);
		collectionName = faker.string.alphanumeric(12);
		({ id: collectionId } = await createCollection(
			url,
			ownerKey,
			collectionName,
			"private description",
		));
		exerciseId = await getFirstExerciseId(url, ownerKey);
		await addEntitiesToCollection(url, ownerKey, ownerId, collectionName, [
			{ entityId: exerciseId, entityLot: EntityLot.Exercise },
		]);
	});

	it("does not let another user revoke an access link", async () => {
		await client.request(
			CreateAccessLinkDocument,
			{ input: { name: faker.string.alphanumeric(8) } },
			headers(ownerKey),
		);
		const { userAccessLinks } = await client.request(
			UserAccessLinksDocument,
			{},
			headers(ownerKey),
		);
		const link = userAccessLinks[0];

		await expect(
			client.request(
				RevokeAccessLinkDocument,
				{ accessLinkId: link.id },
				headers(attackerKey),
			),
		).rejects.toThrow("Access link not found");

		const after = await client.request(
			UserAccessLinksDocument,
			{},
			headers(ownerKey),
		);
		expect(after.userAccessLinks.find((l) => l.id === link.id)?.isRevoked).toBe(
			false,
		);

		await client.request(
			RevokeAccessLinkDocument,
			{ accessLinkId: link.id },
			headers(ownerKey),
		);
		const revoked = await client.request(
			UserAccessLinksDocument,
			{},
			headers(ownerKey),
		);
		expect(
			revoked.userAccessLinks.find((l) => l.id === link.id)?.isRevoked,
		).toBe(true);
	});

	it("does not let another user read a collection", async () => {
		await expect(
			getCollectionContents(url, attackerKey, collectionId),
		).rejects.toThrow("Collection not found");

		const items = await getCollectionContents(url, ownerKey, collectionId);
		expect(items).toHaveLength(1);
	});

	it("does not let another user take over a collection", async () => {
		await expect(
			client.request(
				CreateOrUpdateCollectionDocument,
				{ input: { name: "hijacked", updateId: collectionId } },
				headers(attackerKey),
			),
		).rejects.toThrow("Collection not found");

		const items = await getCollectionContents(url, ownerKey, collectionId);
		expect(items).toHaveLength(1);
	});

	it("does not let another user remove entities from a collection", async () => {
		await client.request(
			DeployRemoveEntitiesFromCollectionJobDocument,
			{
				input: {
					collectionName,
					creatorUserId: ownerId,
					entities: [{ entityId: exerciseId, entityLot: EntityLot.Exercise }],
				},
			},
			headers(attackerKey),
		);
		await waitFor(2000);

		const items = await getCollectionContents(url, ownerKey, collectionId);
		expect(items).toHaveLength(1);
	});
});
