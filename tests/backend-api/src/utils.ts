import { faker } from "@faker-js/faker";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	DeployBulkMetadataProgressUpdateDocument,
	GraphqlSortOrder,
	LoginUserDocument,
	MediaLot,
	MediaSource,
	type MetadataProgressUpdateInput,
	MetadataSearchDocument,
	RegisterUserDocument,
	UserCollectionsListDocument,
	UserExercisesListDocument,
	UserMeasurementsListDocument,
	UserMetadataListDocument,
	UserWorkoutsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";

export const TEST_ADMIN_ACCESS_TOKEN = "test-admin-access-token-for-e2e-tests";

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

export async function searchTmdbMovie(
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
				lot: MediaLot.Movie,
				source: MediaSource.Tmdb,
			},
		},
		{ Authorization: `Bearer ${userApiKey}` },
	);
	return metadataSearch.items;
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
