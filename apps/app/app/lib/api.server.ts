import { GraphQLClient } from "graphql-request";
import { authCookie } from "~/lib/cookies.server";

const apiUrl = import.meta.env.VITE_API_URL;

const getAuthorizationCookie = async (request: Request) => {
	const cookie = await authCookie.parse(request.headers.get("Cookie") || "");
	return cookie;
};

export const getAuthorizationHeader = async (request: Request) => {
	const cookie = await getAuthorizationCookie(request);
	return { Authorization: `Bearer ${cookie.token}` };
};

export const gqlClient = new GraphQLClient(`${apiUrl}/graphql`, {
	headers: { Connection: "keep-alive" },
});
