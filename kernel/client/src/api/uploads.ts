import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class UploadsApi extends Context.Service<UploadsApi>()("UploadsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			createIntent: (scope: ApiScope, request: ContractRequest<"uploads", "createIntent">) =>
				api.run(scope, (client) => client.uploads.createIntent(request)),
			completeIntent: (scope: ApiScope, request: ContractRequest<"uploads", "completeIntent">) =>
				api.run(scope, (client) => client.uploads.completeIntent(request)),
			resolveDownloads: (
				scope: ApiScope,
				request: ContractRequest<"uploads", "resolveDownloads">,
			) => api.run(scope, (client) => client.uploads.resolveDownloads(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
