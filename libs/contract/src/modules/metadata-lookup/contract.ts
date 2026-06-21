import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";

import { NotFound, SandboxRunError } from "../../errors";
import { IntegrationId } from "../../schema/brands";
import { MetadataLookupBody, MetadataLookupResponse } from "./schemas";

const integrationIdParam = HttpApiSchema.param("integrationId", IntegrationId);

export const MetadataLookupGroup = HttpApiGroup.make("metadataLookup")
	.annotate(OpenApi.Description, "Look up metadata through configured integrations.")
	.addError(NotFound, { status: 404 })
	.addError(SandboxRunError, { status: 502 })
	.add(
		HttpApiEndpoint.post("lookup")`/metadata-lookup/${integrationIdParam}`
			.annotate(OpenApi.Description, "Look up metadata using a specified integration.")
			.setPayload(MetadataLookupBody)
			.addSuccess(MetadataLookupResponse),
	);
