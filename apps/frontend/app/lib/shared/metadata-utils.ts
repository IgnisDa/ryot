import { MetadataDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { clientGqlService } from "./react-query";

export const getMetadataDetails = async (metadataId: string) =>
	clientGqlService
		.request(MetadataDetailsDocument, { metadataId })
		.then((d) => d.metadataDetails.response);
