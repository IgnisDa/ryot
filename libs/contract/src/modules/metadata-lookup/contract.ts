import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";

import { NotFound, SandboxRunError } from "../../errors";
import { IntegrationId } from "../../schema/brands";
import { MetadataLookupBody, MetadataLookupResponse } from "./schemas";

const integrationIdParam = HttpApiSchema.param("integrationId", IntegrationId);

export const MetadataLookupGroup = HttpApiGroup.make("metadataLookup")
	.addError(NotFound, { status: 404 })
	.addError(SandboxRunError, { status: 502 })
	.add(
		HttpApiEndpoint.post("lookup")`/metadata-lookup/${integrationIdParam}`
			.setPayload(MetadataLookupBody)
			.addSuccess(MetadataLookupResponse),
	);
