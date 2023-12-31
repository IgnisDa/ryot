import {
	CoreDetailsDocument,
	CoreEnabledFeaturesDocument,
	UserDetailsDocument,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";

export const getCoreEnabledFeatures = async () => {
	const { coreEnabledFeatures } = await gqlClient.request(
		CoreEnabledFeaturesDocument,
	);
	return coreEnabledFeatures;
};

export const getCoreDetails = async () => {
	const { coreDetails } = await gqlClient.request(CoreDetailsDocument);
	return coreDetails;
};

export const getUserPreferences = async (request: Request) => {
	const { userPreferences } = await gqlClient.request(
		UserPreferencesDocument,
		undefined,
		await getAuthorizationHeader(request),
	);
	return userPreferences;
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
