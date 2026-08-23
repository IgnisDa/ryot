import type { ContractRequest } from "@ryot-app/contract/client";
import type { BackupRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Option } from "effect";
import { Headers, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

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
					const request = HttpClientRequest.get(
						resolveApiUrl(scope.serverUrl, `backups/runs/${runId}/download`),
					).pipe(HttpClientRequest.setHeaders(headers));
					const response = yield* http
						.execute(request)
						.pipe(Effect.mapError((cause) => new AuthenticatedApiError({ cause })));
					if (response.status < 200 || response.status >= 300) {
						return yield* new AuthenticatedApiError({ cause: response.status });
					}
					const buffer = yield* response.arrayBuffer.pipe(
						Effect.mapError((cause) => new AuthenticatedApiError({ cause })),
					);
					const contentType = Option.getOrElse(
						Headers.get(response.headers, "content-type"),
						() => "application/zip",
					);
					return new Blob([buffer], { type: contentType });
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
