import type { EntityId, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { Effect } from "effect";

import { getProviderEntityImportResult, startProviderEntityImport } from "@/api/queries";

import { importProviderEntity } from "./import-controller";

export const runProviderEntityImport = (input: {
	readonly serverUrl: string;
	readonly externalId: string;
	readonly providerId: SandboxProviderId;
	readonly onImported?: ((entityId: EntityId) => Effect.Effect<void>) | undefined;
}) =>
	importProviderEntity({
		onImported: input.onImported,
		poll: (jobId) => getProviderEntityImportResult(input.serverUrl, jobId),
		start: startProviderEntityImport(input.serverUrl, {
			providerId: input.providerId,
			externalId: input.externalId,
		}),
	});
