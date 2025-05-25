import {
	LoginUserDocument,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";

export const TEST_USERNAME = "testuser";
export const TEST_PASSWORD = "testpassword123";

export const getGraphqlClient = (baseUrl: string) => {
	return new GraphQLClient(`${baseUrl}/backend/graphql`);
};

export async function registerTestUser(baseUrl: string): Promise<string> {
	const client = getGraphqlClient(baseUrl);

	try {
		const { registerUser } = await client.request(RegisterUserDocument, {
			input: {
				data: {
					password: { username: TEST_USERNAME, password: TEST_PASSWORD },
				},
			},
		});

		if (registerUser.__typename === "RegisterError") {
			throw new Error(`Failed to register test user: ${registerUser.error}`);
		}

		console.log(
			`[Test Utils] Test user '${TEST_USERNAME}' registered successfully with ID: ${registerUser.id}`,
		);

		const { loginUser } = await client.request(LoginUserDocument, {
			input: {
				password: { username: TEST_USERNAME, password: TEST_PASSWORD },
			},
		});

		if (loginUser.__typename === "LoginError") {
			throw new Error(`Failed to login test user: ${loginUser.error}`);
		}

		console.log(
			`[Test Utils] Test user '${TEST_USERNAME}' logged in successfully with API key: ${loginUser.apiKey}`,
		);

		return loginUser.apiKey;
	} catch (err) {
		console.error("[Test Utils] Error registering test user:", err);
		throw err;
	}
}
