import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { authCookie } from "~/lib/cookies.server";

export const API_URL = import.meta.env.VITE_API_URL;

export const gqlClient = new GraphQLClient(`${API_URL}/graphql`, {
	headers: { Connection: "keep-alive" },
});

const getAuthorizationCookie = async (request: Request) => {
	const cookie = await authCookie.parse(request.headers.get("Cookie") || "");
	return cookie;
};

export const getAuthorizationHeader = async (request: Request) => {
	const cookie = await getAuthorizationCookie(request);
	return { Authorization: `Bearer ${cookie}` };
};

export const getIsAuthenticated = async (request: Request) => {
	const cookie = await getAuthorizationCookie(request);
	if (!cookie) return [false, null] as const;
	const { userDetails } = await gqlClient.request(
		UserDetailsDocument,
		undefined,
		await getAuthorizationHeader(request),
	);
	return [userDetails.__typename === "User", userDetails] as const;
};
