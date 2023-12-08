import { $path } from "@ignisda/remix-routes";
import { redirect } from "@remix-run/node";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { authCookie } from "~/lib/cookies.server";
import { createToastHeaders } from "./toast.server";

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

export const redirectIfNotAuthenticated = async (request: Request) => {
	const [isAuthenticated, userDetails] = await getIsAuthenticated(request);
	if (!isAuthenticated)
		throw redirect($path("/auth/login"), {
			status: 302,
			headers: await createToastHeaders({
				message: "You must be logged in to view this page",
			}),
		});
	return userDetails;
};
