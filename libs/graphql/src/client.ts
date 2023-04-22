import { GraphQLClient } from "graphql-request";
import serialize = require("./serialize");

export const createGqlClient = (baseUrl: string, keepAlive = false) => {
	const headers: Record<string, string> = {};
	if (keepAlive) headers["connection"] = "keep-alive";
	return new GraphQLClient(`${baseUrl}/graphql`, {
		headers,
		credentials: "include",
		jsonSerializer: serialize.gqlSerializer,
	});
};

export const getAuthHeader = (issuerString: string) => ({
	"X-Auth-Token": `${issuerString}`,
});

export type { GraphQLClient };
