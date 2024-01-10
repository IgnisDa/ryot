import { $path } from "@ignisda/remix-routes";
import { redirect } from "@remix-run/node";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { withQuery } from "ufo";
import { authCookie } from "~/lib/cookies.server";
import { redirectToQueryParam } from "./generals";
import { createToastHeaders } from "./toast.server";
import { combineHeaders, getLogoutCookies } from "./utilities.server";

export const API_URL = process.env.API_URL || "http://localhost:5000";

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
	try {
		const { userDetails } = await gqlClient.request(
			UserDetailsDocument,
			undefined,
			await getAuthorizationHeader(request),
		);
		return [userDetails.__typename === "User", userDetails] as const;
	} catch {
		return [false, null] as const;
	}
};

export const redirectIfNotAuthenticated = async (request: Request) => {
	const [isAuthenticated, userDetails] = await getIsAuthenticated(request);
	if (!isAuthenticated) {
		const url = new URL(request.url);
		throw redirect(
			withQuery($path("/auth/login"), {
				[redirectToQueryParam]: url.pathname + url.search,
			}),
			{
				status: 302,
				headers: combineHeaders(
					await createToastHeaders({
						message: "You must be logged in to view this page",
					}),
					{ "Set-Cookie": await getLogoutCookies() },
				),
			},
		);
	}
	return userDetails;
};
