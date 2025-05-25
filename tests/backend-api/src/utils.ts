import { faker } from "@faker-js/faker";
import {
	LoginUserDocument,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";

export const TEST_ADMIN_ACCESS_TOKEN = "test-admin-access-token-for-e2e-tests";

export const getGraphqlClient = (baseUrl: string) => {
	return new GraphQLClient(`${baseUrl}/backend/graphql`);
};

export async function registerTestUser(baseUrl: string): Promise<string> {
	const username = faker.internet.username();
	const password = faker.internet.password();
	const client = getGraphqlClient(baseUrl);

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

		return loginUser.apiKey;
	} catch (err) {
		console.error("[Test Utils] Error registering test user:", err);
		throw err;
	}
}
