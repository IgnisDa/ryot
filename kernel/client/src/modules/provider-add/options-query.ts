import type { SearchProviderOptionsResponse } from "@ryot-app/contract/modules/entity-providers/schemas";
import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import type { KernelHostServices } from "#/host-services";
import { type ProviderAddLoadError, ProviderAddService } from "#/modules/provider-add/service";

export const providerSearchOptionsQuery = createRyotQuery<
	SandboxProviderId,
	SearchProviderOptionsResponse,
	KernelHostServices,
	ProviderAddLoadError
>(
	({ input, hostServices }) =>
		hostServices.runtime.runSync(ProviderAddService).loadSearchOptions(hostServices.scope, input),
	{ cancelOnUnmount: true },
);
