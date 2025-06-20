import {
	AddEntityToCollectionDocument,
	CreateOrUpdateCollectionDocument,
	CreateOrUpdateUserWorkoutDocument,
	CreateUserMeasurementDocument,
	DeleteCollectionDocument,
	DeleteUserMeasurementDocument,
	DeleteUserWorkoutDocument,
	DisassociateMetadataDocument,
	EntityLot,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getCollectionContents,
	getFirstExerciseId,
	getGraphqlClient,
	getUserCollectionsList,
	getUserMeasurementsList,
	getUserMetadataList,
	getUserWorkoutsList,
	progressUpdate,
	registerTestUser,
	searchTmdbMovie,
	waitFor,
} from "src/utils";
import { beforeAll, describe, expect, it } from "vitest";

describe("Cache related tests", () => {
	const url = process.env.API_BASE_URL as string;
	let userId: string;
	let userApiKey: string;

	beforeAll(async () => {
		[userApiKey, userId] = await registerTestUser(url);
	});

	const getAuthHeaders = () => ({
		Authorization: `Bearer ${userApiKey}`,
	});

	it("should reflect changes in collections count (0→create→1→delete→0)", async () => {
		const client = getGraphqlClient(url);

		const initial = await getUserCollectionsList(url, userApiKey);
		expect(initial).toHaveLength(7);

		const createResult = await client.request(
			CreateOrUpdateCollectionDocument,
			{
				input: {
					name: "Test Cache Collection",
					description: "Collection for cache testing",
				},
			},
			getAuthHeaders(),
		);
		expect(createResult.createOrUpdateCollection.id).toBeDefined();

		const afterCreate = await getUserCollectionsList(url, userApiKey);
		expect(afterCreate).toHaveLength(8);

		const deleteResult = await client.request(
			DeleteCollectionDocument,
			{ collectionName: "Test Cache Collection" },
			getAuthHeaders(),
		);
		expect(deleteResult.deleteCollection).toBe(true);

		const afterDelete = await getUserCollectionsList(url, userApiKey);
		expect(afterDelete).toHaveLength(7);
	});

	it("should reflect changes in workouts count (0→create→1→delete→0)", async () => {
		const client = getGraphqlClient(url);

		const initial = await getUserWorkoutsList(url, userApiKey);
		expect(initial).toHaveLength(0);

		const exerciseId = await getFirstExerciseId(url, userApiKey);

		const workoutInput = {
			supersets: [],
			name: "Test Cache Workout",
			startTime: new Date().toISOString(),
			endTime: new Date(Date.now() + 3600000).toISOString(),
			exercises: [
				{
					exerciseId: exerciseId,
					notes: [],
					unitSystem: UserUnitSystem.Metric,
					sets: [
						{
							lot: SetLot.Normal,
							statistic: {
								reps: "10",
								weight: "50",
							},
						},
					],
				},
			],
		};

		const createResult = await client.request(
			CreateOrUpdateUserWorkoutDocument,
			{ input: workoutInput },
			getAuthHeaders(),
		);
		expect(createResult.createOrUpdateUserWorkout).toBeDefined();

		const afterCreate = await getUserWorkoutsList(url, userApiKey);
		expect(afterCreate).toHaveLength(1);

		const deleteResult = await client.request(
			DeleteUserWorkoutDocument,
			{ workoutId: createResult.createOrUpdateUserWorkout },
			getAuthHeaders(),
		);
		expect(deleteResult.deleteUserWorkout).toBe(true);

		const afterDelete = await getUserWorkoutsList(url, userApiKey);
		expect(afterDelete).toHaveLength(0);
	});

	it("should reflect changes in measurements count (0→create→1→delete→0)", async () => {
		const client = getGraphqlClient(url);

		const initial = await getUserMeasurementsList(url, userApiKey);
		expect(initial).toHaveLength(0);

		const measurementInput = {
			name: "Weight",
			timestamp: new Date().toISOString(),
			information: {
				statistics: [{ name: "Weight", value: "70.5" }],
				assets: {
					s3Images: [],
					s3Videos: [],
					remoteVideos: [],
					remoteImages: [],
				},
			},
		};

		const createResult = await client.request(
			CreateUserMeasurementDocument,
			{ input: measurementInput },
			getAuthHeaders(),
		);
		expect(createResult.createUserMeasurement).toBeDefined();

		const afterCreate = await getUserMeasurementsList(url, userApiKey);
		expect(afterCreate).toHaveLength(1);

		const deleteResult = await client.request(
			DeleteUserMeasurementDocument,
			{ timestamp: createResult.createUserMeasurement },
			getAuthHeaders(),
		);
		expect(deleteResult.deleteUserMeasurement).toBe(true);

		const afterDelete = await getUserMeasurementsList(url, userApiKey);
		expect(afterDelete).toHaveLength(0);
	});

	it("should reflect changes in associated metadata count (search→add→1→disassociate→0)", async () => {
		const client = getGraphqlClient(url);

		const initial = await getUserMetadataList(url, userApiKey);
		expect(initial).toHaveLength(0);

		const searchResult = await searchTmdbMovie(url, userApiKey, "avengers");
		expect(searchResult.length).toBeGreaterThan(0);

		const firstMetadataId = searchResult[0];
		const addToCollectionResult = await client.request(
			AddEntityToCollectionDocument,
			{
				input: {
					creatorUserId: userId,
					entityId: firstMetadataId,
					collectionName: "Watchlist",
					entityLot: EntityLot.Metadata,
				},
			},
			getAuthHeaders(),
		);
		expect(addToCollectionResult.addEntityToCollection).toBe(true);
		await waitFor(4000);

		const afterAdd = await getUserMetadataList(url, userApiKey);
		expect(afterAdd).toHaveLength(1);

		const disassociateResult = await client.request(
			DisassociateMetadataDocument,
			{ metadataId: firstMetadataId },
			getAuthHeaders(),
		);
		expect(disassociateResult.disassociateMetadata).toBe(true);

		const afterDisassociate = await getUserMetadataList(url, userApiKey);
		expect(afterDisassociate).toHaveLength(0);
	});

	it("should update collection ordering when movie progress is updated", async () => {
		const collectionsResponse = await getUserCollectionsList(url, userApiKey);
		const inProgressCollection = collectionsResponse.find(
			(c) => c.name === "In Progress",
		);
		expect(inProgressCollection).toBeDefined();

		if (!inProgressCollection) {
			throw new Error("In Progress collection not found");
		}

		const searchResult = await searchTmdbMovie(url, userApiKey, "star wars");
		expect(searchResult.length).toBeGreaterThan(1);

		const firstMovieId = searchResult[0];
		const secondMovieId = searchResult[1];

		await progressUpdate(url, userApiKey, [
			{
				metadataId: firstMovieId,
				change: {
					createNewInProgress: { startedOn: new Date().toISOString() },
				},
			},
			{
				metadataId: secondMovieId,
				change: {
					createNewInProgress: { startedOn: new Date().toISOString() },
				},
			},
		]);
		await waitFor(2000);

		const initialContents = await getCollectionContents(
			url,
			userApiKey,
			inProgressCollection.id,
		);

		expect(initialContents).toHaveLength(2);

		const initialFirstMovie = initialContents[0].entityId;
		const initialSecondMovie = initialContents[1].entityId;
		expect(initialFirstMovie).toBe(secondMovieId);
		expect(initialSecondMovie).toBe(firstMovieId);

		await progressUpdate(url, userApiKey, [
			{
				metadataId: firstMovieId,
				change: { changeLatestInProgress: { progress: "25" } },
			},
		]);
		await waitFor(2000);

		const updatedContents = await getCollectionContents(
			url,
			userApiKey,
			inProgressCollection.id,
		);
		expect(updatedContents).toHaveLength(2);

		const updatedFirstMovie = updatedContents[0].entityId;
		const updatedSecondMovie = updatedContents[1].entityId;
		expect(updatedFirstMovie).toBe(firstMovieId);
		expect(updatedSecondMovie).toBe(secondMovieId);

		await progressUpdate(url, userApiKey, [
			{
				metadataId: firstMovieId,
				change: { changeLatestInProgress: { progress: "100" } },
			},
			{
				metadataId: secondMovieId,
				change: { changeLatestInProgress: { progress: "100" } },
			},
		]);
		await waitFor(2000);

		const finalContents = await getCollectionContents(
			url,
			userApiKey,
			inProgressCollection.id,
		);
		expect(finalContents).toHaveLength(0);
	});
});
