import {
	CoreDetailsDocument,
	CoreEnabledFeaturesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { gqlClient } from "~/lib/api.server";

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
