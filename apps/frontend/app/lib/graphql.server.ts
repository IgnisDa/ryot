import { $path } from "@ignisda/remix-routes";
import { redirect } from "@remix-run/node";
import {
	type CoreDetails,
	CoreEnabledFeaturesDocument,
	type UserCollectionsListQuery,
	type UserPreferences,
} from "@ryot/generated/graphql/backend/graphql";
import { withQuery, withoutHost } from "ufo";
import { gqlClient } from "~/lib/api.server";
import {
	coreDetailsCookie,
	userCollectionsListCookie,
	userDetailsCookie,
	userPreferencesCookie,
} from "./cookies.server";
import { redirectToQueryParam } from "./generals";
import type { ApplicationUser } from "./utilities.server";

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
	redirectIfDetailNotPresent(request, details);
	return details as CoreDetails;
};

export const getUserPreferences = async (request: Request) => {
	const prefs = await userPreferencesCookie.parse(
		request.headers.get("cookie") || "",
	);
	redirectIfDetailNotPresent(request, prefs);
	return prefs as UserPreferences;
};

export const getUserDetails = async (request: Request) => {
	const details = await userDetailsCookie.parse(
		request.headers.get("cookie") || "",
	);
	redirectIfDetailNotPresent(request, details);
	return details as ApplicationUser;
};

export const getUserCollectionsList = async (request: Request) => {
	const list = await userCollectionsListCookie.parse(
		request.headers.get("cookie") || "",
	);
	redirectIfDetailNotPresent(request, list);
	return list as UserCollectionsListQuery["userCollectionsList"];
};

const redirectIfDetailNotPresent = (request: Request, detail: unknown) => {
	if (!detail)
		throw redirect(
			withQuery($path("/actions"), {
				[redirectToQueryParam]: withoutHost(request.url),
			}),
		);
};
