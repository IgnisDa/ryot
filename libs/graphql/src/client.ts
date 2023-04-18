import { GraphQLClient } from "graphql-request";

export const createGqlClient = (baseUrl: string) =>
	new GraphQLClient(`${baseUrl}/graphql`, {
		headers: { connection: "keep-alive" },
	});

export const getAuthHeader = (issuerString: string) => ({
	"X-Auth-Token": `${issuerString}`,
});

export type { GraphQLClient };
