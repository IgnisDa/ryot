import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";

import { getProviderEntityImportResult, startProviderEntityImport } from "@/api/provider-entities";
import type { ApiScope } from "@/api/request-key";

import { importProviderEntity } from "./import-controller";

export const runProviderEntityImport = (input: {
	readonly scope: ApiScope;
	readonly externalId: string;
	readonly providerId: SandboxProviderId;
}) =>
	importProviderEntity({
		poll: (jobId) => getProviderEntityImportResult(input.scope, jobId),
		start: startProviderEntityImport(input.scope, {
			providerId: input.providerId,
			externalId: input.externalId,
		}),
	});
