import { $path } from "@ignisda/remix-routes";
import { redirect } from "@remix-run/node";
import {
	type CoreDetails,
	CoreEnabledFeaturesDocument,
	type User,
	type UserPreferences,
} from "@ryot/generated/graphql/backend/graphql";
import { withQuery, withoutHost } from "ufo";
import { gqlClient } from "~/lib/api.server";
import {
	coreDetailsCookie,
	userDetailsCookie,
	userPreferencesCookie,
} from "./cookies.server";
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
	const details = await userDetailsCookie.parse(
		request.headers.get("cookie") || "",
	);
	if (!details)
		throw redirect(
			withQuery($path("/actions"), {
				[redirectToQueryParam]: withoutHost(request.url),
			}),
		);
	return details as User;
};
