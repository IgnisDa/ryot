import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { downloadFile } from "#/modules/downloads/file";

export const importRunFailuresFileName = (runId: string) => `ryot-import-failures-${runId}.json`;

export class ImportsApi extends Context.Service<ImportsApi>()("ImportsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		const http = yield* HttpClient.HttpClient;
		return {
			createRun: (scope: ApiScope, request: ContractRequest<"imports", "createRun">) =>
				api.run(scope, (client) => client.imports.createRun(request)),
			cancelRun: (scope: ApiScope, request: ContractRequest<"imports", "cancelRun">) =>
				api.run(scope, (client) => client.imports.cancelRun(request)),
			deleteRun: (scope: ApiScope, request: ContractRequest<"imports", "deleteRun">) =>
				api.run(scope, (client) => client.imports.deleteRun(request)),
			downloadFailures: (scope: ApiScope, runId: string) =>
				Effect.gen(function* () {
					const headers = yield* api.authorization(scope);
					return yield* downloadFile(http, {
						headers,
						fileName: importRunFailuresFileName(runId),
						url: resolveApiUrl(
							scope.serverUrl,
							`imports/runs/${encodeURIComponent(runId)}/failures/download`,
						),
					}).pipe(
						Effect.mapError(
							(error) => new AuthenticatedApiError({ cause: error.status ?? error.cause }),
						),
					);
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
