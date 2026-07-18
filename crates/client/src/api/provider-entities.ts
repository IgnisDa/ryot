import type {
	ImportEntityBody,
	SearchProviderEntitiesBody,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { appClient, retryQueryResponse } from "./client";
import type { ApiScope } from "./request-key";

export const queryProviderSearchOptions = (scope: ApiScope, providerId: SandboxProviderId) =>
	appClient(scope).request.pipe(
		Effect.flatMap((client) => client.providerEntities.searchOptions({ payload: { providerId } })),
		retryQueryResponse,
	);

export const searchProviderEntities = (scope: ApiScope, payload: SearchProviderEntitiesBody) =>
	appClient(scope).request.pipe(
		Effect.flatMap((client) => client.providerEntities.search({ payload })),
		retryQueryResponse,
	);

export const startProviderEntityImport = (scope: ApiScope, payload: ImportEntityBody) =>
	appClient(scope).request.pipe(
		Effect.flatMap((client) => client.providerEntities.import({ payload })),
	);

export const getProviderEntityImportResult = (scope: ApiScope, jobId: string) =>
	appClient(scope).request.pipe(
		Effect.flatMap((client) => client.providerEntities.getImportResult({ params: { jobId } })),
		retryQueryResponse,
	);
