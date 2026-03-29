import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { retryQueryResponse } from "@/api/app-api";
import { authenticatedExpoContractClient } from "@/api/transport";

export const executeRyotQL = (serverUrl: string, queryDocument: RyotQLDocument) =>
	authenticatedExpoContractClient(serverUrl).pipe(
		Effect.flatMap((client) => client.ryotql.execute({ payload: queryDocument })),
		retryQueryResponse,
	);
