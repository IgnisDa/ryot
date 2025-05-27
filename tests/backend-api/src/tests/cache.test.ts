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
	MediaLot,
	MediaSource,
	MetadataSearchDocument,
	SetLot,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getFirstExerciseId,
	getGraphqlClient,
	getUserCollectionsList,
	getUserMeasurementsList,
	getUserMetadataList,
	getUserWorkoutsList,
	registerTestUser,
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

		const searchResult = await client.request(
			MetadataSearchDocument,
			{
				input: {
					lot: MediaLot.Movie,
					source: MediaSource.Tmdb,
					search: { query: "avengers" },
				},
			},
			getAuthHeaders(),
		);
		expect(searchResult.metadataSearch.items.length).toBeGreaterThan(0);

		const firstMetadataId = searchResult.metadataSearch.items[0];
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
});
