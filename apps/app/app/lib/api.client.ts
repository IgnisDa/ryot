import { GraphQLClient } from "graphql-request";

const API_URL =
	import.meta.env.VITE_API_URL ||
	`${typeof window !== "undefined" ? window.location.origin : ""}/backend`;

export const gqlClientSide = new GraphQLClient(`${API_URL}/graphql`, {
	credentials: "include",
});
