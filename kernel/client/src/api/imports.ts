import type { ContractRequest } from "@ryot-app/contract/client";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { FileDownloads } from "#/modules/downloads/file";

export const importRunFailuresFileName = (runId: string) => `ryot-import-failures-${runId}.json`;

export class ImportsApi extends Context.Service<ImportsApi>()("ImportsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		const downloads = yield* FileDownloads;
		return {
			createRun: (scope: ApiScope, request: ContractRequest<"imports", "createRun">) =>
				api.run(scope, (client) => client.imports.createRun(request)),
			cancelRun: (scope: ApiScope, request: ContractRequest<"imports", "cancelRun">) =>
				api.run(scope, (client) => client.imports.cancelRun(request)),
			deleteRun: (scope: ApiScope, request: ContractRequest<"imports", "deleteRun">) =>
				api.run(scope, (client) => client.imports.deleteRun(request)),
			downloadFailures: (scope: ApiScope, runId: string) =>
				Effect.gen(function* () {
					const ticket = yield* api.run(scope, (client) =>
						client.imports.createFailuresDownloadTicket({
							params: { runId: ImportRunId.make(runId) },
						}),
					);
					yield* downloads
						.download({
							fileName: importRunFailuresFileName(runId),
							url: resolveApiUrl(scope.serverUrl, ticket.url),
						})
						.pipe(Effect.mapError((error) => new AuthenticatedApiError({ cause: error.cause })));
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
