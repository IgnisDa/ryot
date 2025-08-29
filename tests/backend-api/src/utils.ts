import { faker } from "@faker-js/faker";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	DeployAddEntitiesToCollectionJobDocument,
	DeployBulkMetadataProgressUpdateDocument,
	type EntityLot,
	GraphqlSortOrder,
	LoginUserDocument,
	MediaLot,
	MediaSource,
	type MetadataProgressUpdateInput,
	MetadataSearchDocument,
	RegisterUserDocument,
	UpdateUserDocument,
	UserCollectionsListDocument,
	UserExercisesListDocument,
	UserLot,
	UserMeasurementsListDocument,
	UserMetadataListDocument,
	UserWorkoutsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";

export const TEST_ADMIN_ACCESS_TOKEN = "test-admin-access-token-for-e2e-tests";
export const DEFAULT_USER_COLLECTIONS_COUNT = 7;

export const getGraphqlClient = (baseUrl: string) => {
	return new GraphQLClient(`${baseUrl}/backend/graphql`);
};

export async function registerTestUser(baseUrl: string) {
	const client = getGraphqlClient(baseUrl);
	const username = faker.internet.username();
	const password = faker.internet.password();
	console.log(
		`[Test Utils] Registering user with username: ${username}, password: ${password}`,
	);

	try {
		const { registerUser } = await client.request(RegisterUserDocument, {
			input: { data: { password: { username, password } } },
		});

		if (registerUser.__typename === "RegisterError") {
			throw new Error(`Failed to register test user: ${registerUser.error}`);
		}

		console.log(
			`[Test Utils] Test user '${username}' registered successfully with ID: ${registerUser.id}`,
		);

		const { loginUser } = await client.request(LoginUserDocument, {
			input: { password: { username, password } },
		});

		if (loginUser.__typename === "LoginError") {
			throw new Error(`Failed to login test user: ${loginUser.error}`);
		}

		if (loginUser.__typename !== "ApiKeyResponse") {
			throw new Error(
				`Expected ApiKeyResponse but got ${loginUser.__typename}`,
			);
		}

		console.log(
			`[Test Utils] Test user '${username}' logged in successfully with API key: ${loginUser.apiKey}`,
		);

		return [loginUser.apiKey, registerUser.id] as const;
	} catch (err) {
		console.error("[Test Utils] Error registering test user:", err);
		throw err;
	}
}

export async function getUserCollectionsList(
	baseUrl: string,
	userApiKey: string,
) {
	const client = getGraphqlClient(baseUrl);
	const { userCollectionsList } = await client.request(
		UserCollectionsListDocument,
		{},
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return userCollectionsList.response;
}

export async function getUserWorkoutsList(baseUrl: string, userApiKey: string) {
	const client = getGraphqlClient(baseUrl);
	const { userWorkoutsList } = await client.request(
		UserWorkoutsListDocument,
		{ input: { search: {} } },
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return userWorkoutsList.response.items;
}

export async function getUserMeasurementsList(
	baseUrl: string,
	userApiKey: string,
) {
	const client = getGraphqlClient(baseUrl);
	const { userMeasurementsList } = await client.request(
		UserMeasurementsListDocument,
		{ input: {} },
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return userMeasurementsList.response;
}

export async function getFirstExerciseId(
	baseUrl: string,
	userApiKey: string,
): Promise<string> {
	const client = getGraphqlClient(baseUrl);
	const { userExercisesList } = await client.request(
		UserExercisesListDocument,
		{
			input: {
				search: { query: "" },
			},
		},
		{
			Authorization: `Bearer ${userApiKey}`,
		},
	);

	if (userExercisesList.response.items.length === 0) {
		throw new Error("No exercises found in the database");
	}

	return userExercisesList.response.items[0];
}

export async function getUserMetadataList(baseUrl: string, userApiKey: string) {
	const client = getGraphqlClient(baseUrl);
	const { userMetadataList } = await client.request(
		UserMetadataListDocument,
		{ input: {} },
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return userMetadataList.response.items;
}

export async function searchAudibleAudiobook(
	baseUrl: string,
	userApiKey: string,
	query: string,
) {
	const client = getGraphqlClient(baseUrl);
	const { metadataSearch } = await client.request(
		MetadataSearchDocument,
		{
			input: {
				search: { query },
				lot: MediaLot.AudioBook,
				source: MediaSource.Audible,
			},
		},
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return metadataSearch.response.items;
}

export async function waitFor(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getCollectionContents(
	baseUrl: string,
	userApiKey: string,
	collectionId: string,
) {
	const client = getGraphqlClient(baseUrl);
	const { collectionContents } = await client.request(
		CollectionContentsDocument,
		{
			input: {
				collectionId,
				sort: {
					order: GraphqlSortOrder.Desc,
					by: CollectionContentsSortBy.LastUpdatedOn,
				},
			},
		},
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return collectionContents.response.results.items;
}

export async function progressUpdate(
	baseUrl: string,
	userApiKey: string,
	input: MetadataProgressUpdateInput[],
) {
	const client = getGraphqlClient(baseUrl);
	const { deployBulkMetadataProgressUpdate } = await client.request(
		DeployBulkMetadataProgressUpdateDocument,
		{ input },
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return deployBulkMetadataProgressUpdate;
}

export async function addEntitiesToCollection(
	baseUrl: string,
	userApiKey: string,
	userId: string,
	collectionName: string,
	entities: { entityId: string; entityLot: EntityLot }[],
) {
	const client = getGraphqlClient(baseUrl);
	return await client.request(
		DeployAddEntitiesToCollectionJobDocument,
		{
			input: {
				creatorUserId: userId,
				collectionName,
				entities,
			},
		},
		{ Authorization: `Bearer ${userApiKey}` },
	);
}

export async function registerAdminUser(baseUrl: string) {
	const client = getGraphqlClient(baseUrl);

	const [userApiKey, userId] = await registerTestUser(baseUrl);

	await client.request(UpdateUserDocument, {
		input: {
			userId,
			lot: UserLot.Admin,
			adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
		},
	});

	console.log(`[Test Utils] User '${userId}' upgraded to admin successfully`);

	return [userApiKey, userId] as const;
}
