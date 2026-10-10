import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import type { ApiScope } from "#/api/scope";

export type UploadByteTransfer = {
	readonly source: Blob;
	readonly uploadUrl: string;
	readonly contentType: string;
	readonly headers: Record<string, string>;
};

export class UploadsApi extends Context.Service<UploadsApi>()("UploadsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		const http = yield* HttpClient.HttpClient;
		return {
			createIntent: (scope: ApiScope, request: ContractRequest<"uploads", "createIntent">) =>
				api.run(scope, (client) => client.uploads.createIntent(request)),
			completeIntent: (scope: ApiScope, request: ContractRequest<"uploads", "completeIntent">) =>
				api.run(scope, (client) => client.uploads.completeIntent(request)),
			resolveDownloads: (
				scope: ApiScope,
				request: ContractRequest<"uploads", "resolveDownloads">,
			) => api.run(scope, (client) => client.uploads.resolveDownloads(request)),
			putBytes: (scope: ApiScope, transfer: UploadByteTransfer) =>
				Effect.gen(function* () {
					const bytes = yield* Effect.tryPromise({
						try: () => transfer.source.arrayBuffer(),
						catch: (cause) => new AuthenticatedApiError({ cause }),
					}).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
					const request = HttpClientRequest.put(
						resolveApiUrl(scope.serverUrl, transfer.uploadUrl),
					).pipe(
						HttpClientRequest.setHeaders({ ...transfer.headers }),
						HttpClientRequest.bodyUint8Array(bytes, transfer.contentType),
					);
					const response = yield* http
						.execute(request)
						.pipe(Effect.mapError((cause) => new AuthenticatedApiError({ cause })));
					if (response.status < 200 || response.status >= 300) {
						return yield* new AuthenticatedApiError({ cause: response.status });
					}
					return yield* Effect.void;
				}),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
