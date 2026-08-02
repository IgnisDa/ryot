import type {
	ImportEntityBody,
	SearchProviderEntitiesBody,
} from "@ryot/contract/modules/provider-entities/schemas";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { retryQueryResponse } from "@/api/app-api";
import { authenticatedExpoContractClient } from "@/api/transport";
import { normalizeServerOrigin } from "@/modules/server/url";

export const executeRyotQL = (serverUrl: string, queryDocument: RyotQLDocument) =>
	authenticatedExpoContractClient(normalizeServerOrigin(serverUrl)).pipe(
		Effect.flatMap((client) => client.ryotql.execute({ payload: queryDocument })),
		retryQueryResponse,
	);

export const searchProviderEntities = (serverUrl: string, payload: SearchProviderEntitiesBody) =>
	authenticatedExpoContractClient(normalizeServerOrigin(serverUrl)).pipe(
		Effect.flatMap((client) => client.providerEntities.search({ payload })),
		retryQueryResponse,
	);

export const startProviderEntityImport = (serverUrl: string, payload: ImportEntityBody) =>
	authenticatedExpoContractClient(normalizeServerOrigin(serverUrl)).pipe(
		Effect.flatMap((client) => client.providerEntities.import({ payload })),
	);

export const getProviderEntityImportResult = (serverUrl: string, jobId: string) =>
	authenticatedExpoContractClient(normalizeServerOrigin(serverUrl)).pipe(
		Effect.flatMap((client) => client.providerEntities.getImportResult({ params: { jobId } })),
		retryQueryResponse,
	);
