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
	let userApiKey: string;

	beforeAll(async () => {
		userApiKey = await registerTestUser(url);
	});

	const getAuthHeaders = () => ({
		Authorization: `Bearer ${userApiKey}`,
	});

	describe("Collections cache tests", () => {
		it("should reflect changes in collections count (0→create→1→delete→0)", async () => {
			const client = getGraphqlClient(url);

			// Initial state: should have 7 system-created collections
			const initial = await getUserCollectionsList(url, userApiKey);
			expect(initial).toHaveLength(7);

			// Create a new collection
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

			// Verify collections count increased to 8
			const afterCreate = await getUserCollectionsList(url, userApiKey);
			expect(afterCreate).toHaveLength(8);

			// Delete the collection
			const deleteResult = await client.request(
				DeleteCollectionDocument,
				{ collectionName: "Test Cache Collection" },
				getAuthHeaders(),
			);
			expect(deleteResult.deleteCollection).toBe(true);

			// Verify collections count returned to 7
			const afterDelete = await getUserCollectionsList(url, userApiKey);
			expect(afterDelete).toHaveLength(7);
		});
	});

	describe("Workouts cache tests", () => {
		it("should reflect changes in workouts count (0→create→1→delete→0)", async () => {
			const client = getGraphqlClient(url);

			// Initial state: should have 0 workouts
			const initial = await getUserWorkoutsList(url, userApiKey);
			expect(initial).toHaveLength(0);

			// Get an exercise to use in the workout
			const exerciseId = await getFirstExerciseId(url, userApiKey);

			// Create a new workout with a proper exercise
			const workoutInput = {
				name: "Test Cache Workout",
				startTime: new Date().toISOString(),
				endTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
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
				supersets: [],
			};

			const createResult = await client.request(
				CreateOrUpdateUserWorkoutDocument,
				{ input: workoutInput },
				getAuthHeaders(),
			);
			expect(createResult.createOrUpdateUserWorkout).toBeDefined();

			// Verify workouts count increased to 1
			const afterCreate = await getUserWorkoutsList(url, userApiKey);
			expect(afterCreate).toHaveLength(1);

			// Delete the workout
			const deleteResult = await client.request(
				DeleteUserWorkoutDocument,
				{ workoutId: createResult.createOrUpdateUserWorkout },
				getAuthHeaders(),
			);
			expect(deleteResult.deleteUserWorkout).toBe(true);

			// Verify workouts count returned to 0
			const afterDelete = await getUserWorkoutsList(url, userApiKey);
			expect(afterDelete).toHaveLength(0);
		});
	});

	describe("Measurements cache tests", () => {
		it("should reflect changes in measurements count (0→create→1→delete→0)", async () => {
			const client = getGraphqlClient(url);

			// Initial state: should have 0 measurements
			const initial = await getUserMeasurementsList(url, userApiKey);
			expect(initial).toHaveLength(0);

			// Create a new measurement
			const measurementInput = {
				timestamp: new Date().toISOString(),
				name: "Weight",
				information: {
					statistics: [
						{
							name: "Weight",
							value: "70.5",
						},
					],
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

			// Verify measurements count increased to 1
			const afterCreate = await getUserMeasurementsList(url, userApiKey);
			expect(afterCreate).toHaveLength(1);

			// Delete the measurement
			const deleteResult = await client.request(
				DeleteUserMeasurementDocument,
				{ timestamp: createResult.createUserMeasurement },
				getAuthHeaders(),
			);
			expect(deleteResult.deleteUserMeasurement).toBe(true);

			// Verify measurements count returned to 0
			const afterDelete = await getUserMeasurementsList(url, userApiKey);
			expect(afterDelete).toHaveLength(0);
		});
	});

	describe("Associated metadata cache tests", () => {
		it("should reflect changes in associated metadata count (search→add→1→disassociate→0)", async () => {
			const client = getGraphqlClient(url);

			// Initial state: should have 0 associated metadata
			const initial = await getUserMetadataList(url, userApiKey);
			expect(initial).toHaveLength(0);

			// Search for "avengers movie"
			const searchResult = await client.request(
				MetadataSearchDocument,
				{
					input: {
						lot: MediaLot.Movie,
						source: MediaSource.Tmdb,
						search: { query: "avengers movie" },
					},
				},
				getAuthHeaders(),
			);
			expect(searchResult.metadataSearch.items.length).toBeGreaterThan(0);

			// Take the first result and add it to a collection
			const firstMetadataId = searchResult.metadataSearch.items[0];
			const addToCollectionResult = await client.request(
				AddEntityToCollectionDocument,
				{
					input: {
						collectionName: "Watchlist", // Default collection
						entityId: firstMetadataId,
						entityLot: EntityLot.Metadata,
						creatorUserId: "", // Will be filled by the backend
					},
				},
				getAuthHeaders(),
			);
			expect(addToCollectionResult.addEntityToCollection).toBe(true);

			// Verify associated metadata count increased to 1
			const afterAdd = await getUserMetadataList(url, userApiKey);
			expect(afterAdd).toHaveLength(1);

			// Disassociate the metadata
			const disassociateResult = await client.request(
				DisassociateMetadataDocument,
				{ metadataId: firstMetadataId },
				getAuthHeaders(),
			);
			expect(disassociateResult.disassociateMetadata).toBe(true);

			// Verify associated metadata count returned to 0
			const afterDisassociate = await getUserMetadataList(url, userApiKey);
			expect(afterDisassociate).toHaveLength(0);
		});
	});
});
