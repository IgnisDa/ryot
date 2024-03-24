import { $path } from "@ignisda/remix-routes";
import { redirect } from "@remix-run/node";
import {
	type CoreDetails,
	CoreEnabledFeaturesDocument,
	UserDetailsDocument,
	type UserPreferences,
} from "@ryot/generated/graphql/backend/graphql";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { coreDetailsCookie, userPreferencesCookie } from "./cookies.server";
import { withQuery, withoutHost } from "ufo";
import { redirectToQueryParam } from "./generals";

export const getCoreEnabledFeatures = async () => {
	const { coreEnabledFeatures } = await gqlClient.request(
		CoreEnabledFeaturesDocument,
	);
	return coreEnabledFeatures;
};

export const getCoreDetails = async (request: Request) => {
	const details = await coreDetailsCookie.parse(
		request.headers.get("cookie") || "",
	);
	if (!details)
		throw redirect(
			withQuery($path("/actions"), {
				[redirectToQueryParam]: withoutHost(request.url),
			}),
		);
	return details as CoreDetails;
};

export const getUserPreferences = async (request: Request) => {
	const prefs = await userPreferencesCookie.parse(
		request.headers.get("cookie") || "",
	);
	if (!prefs)
		throw redirect(
			withQuery($path("/actions"), {
				[redirectToQueryParam]: withoutHost(request.url),
			}),
		);
	return prefs as UserPreferences;
};

export const getUserDetails = async (request: Request) => {
	const { userDetails } = await gqlClient.request(
		UserDetailsDocument,
		undefined,
		await getAuthorizationHeader(request),
	);
	if (userDetails.__typename === "User") return userDetails;
	throw new Error("User not found");
};
