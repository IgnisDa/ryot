import type { ContractRequest } from "@ryot-app/contract/client";
import type { BackupRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { downloadFile } from "#/modules/downloads/file";

export const backupArchiveFileName = (runId: BackupRunId) => `ryot-backup-${runId}.zip`;

export class BackupsApi extends Context.Service<BackupsApi>()("BackupsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		const http = yield* HttpClient.HttpClient;
		return {
			createExport: (scope: ApiScope) => api.run(scope, (client) => client.backups.createExport()),
			deleteRun: (scope: ApiScope, request: ContractRequest<"backups", "deleteRun">) =>
				api.run(scope, (client) => client.backups.deleteRun(request)),
			createRestore: (scope: ApiScope, request: ContractRequest<"backups", "createRestore">) =>
				api.run(scope, (client) => client.backups.createRestore(request)),
			downloadArchive: (scope: ApiScope, runId: BackupRunId) =>
				Effect.gen(function* () {
					const headers = yield* api.authorization(scope);
					return yield* downloadFile(http, {
						headers,
						fileName: backupArchiveFileName(runId),
						url: resolveApiUrl(scope.serverUrl, `backups/runs/${runId}/download`),
					}).pipe(
						Effect.mapError(
							(cause) => new AuthenticatedApiError({ cause: cause.status ?? cause.cause }),
						),
					);
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
