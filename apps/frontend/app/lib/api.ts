import { GraphQLClient } from "graphql-request";

export const gqlClientSide = new GraphQLClient("/backend/graphql", {
	credentials: "include",
});
