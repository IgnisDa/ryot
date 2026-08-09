import type { ContractRequest } from "@ryot-app/contract/client";
import type { BackupRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

export const backupArchiveFileName = (runId: BackupRunId) => `ryot-backup-${runId}.zip`;

export class BackupsApi extends Context.Service<BackupsApi>()("BackupsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			listRuns: (scope: ApiScope) => api.run(scope, (client) => client.backups.listRuns()),
			createExport: (scope: ApiScope) => api.run(scope, (client) => client.backups.createExport()),
			deleteRun: (scope: ApiScope, request: ContractRequest<"backups", "deleteRun">) =>
				api.run(scope, (client) => client.backups.deleteRun(request)),
			createRestore: (scope: ApiScope, request: ContractRequest<"backups", "createRestore">) =>
				api.run(scope, (client) => client.backups.createRestore(request)),
			downloadArchive: (scope: ApiScope, runId: BackupRunId) =>
				Effect.gen(function* () {
					const headers = yield* api.authorization(scope);
					const response = yield* Effect.tryPromise({
						catch: (cause) => new AuthenticatedApiError({ cause }),
						try: (signal) =>
							fetch(resolveApiUrl(scope.serverUrl, `backups/runs/${runId}/download`), {
								signal,
								headers,
							}),
					});
					if (!response.ok) {
						return yield* Effect.fail(new AuthenticatedApiError({ cause: response.status }));
					}
					return yield* Effect.tryPromise({
						try: () => response.blob(),
						catch: (cause) => new AuthenticatedApiError({ cause }),
					});
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
