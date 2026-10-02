import { faker } from "@faker-js/faker";
import {
	LoginUserDocument,
	RegisterUserDocument,
	type UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import type { getGraphqlClient } from "src/utils";

export const newCredentials = () => ({
	username: faker.internet.username(),
	password: faker.internet.password(),
});

export async function registerPasswordUser(
	client: ReturnType<typeof getGraphqlClient>,
	options: {
		adminAccessToken?: string;
		headers?: Record<string, string>;
		lot?: UserLot;
	} = {},
) {
	const credentials = newCredentials();
	const { registerUser } = await client.request(
		RegisterUserDocument,
		{
			input: {
				adminAccessToken: options.adminAccessToken,
				data: { password: credentials },
				lot: options.lot,
			},
		},
		options.headers,
	);
	if (registerUser.__typename !== "StringIdObject") {
		throw new Error(
			`Expected user registration, got ${registerUser.__typename}`,
		);
	}
	const { loginUser } = await client.request(LoginUserDocument, {
		input: { password: credentials },
	});
	if (loginUser.__typename !== "ApiKeyResponse") {
		throw new Error(`Expected user login, got ${loginUser.__typename}`);
	}
	return {
		...credentials,
		apiKey: loginUser.apiKey,
		userId: registerUser.id,
	};
}

export const getSessionId = (changeUrl: string) =>
	new URL(changeUrl, process.env.API_BASE_URL as string).searchParams.get(
		"sessionId",
	) as string;
