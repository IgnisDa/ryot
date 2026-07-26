import type { DbError } from "@ryot/contract/errors";
import type { PluginHttpRateLimit } from "@ryot/contract/modules/plugins/manifest";
import { Context, Effect, Layer, Result } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { buildHttpRateLimitLookups } from "./http-rate-limits";
import { PluginRepository } from "./repository";
import { PluginValidationError } from "./validation";

export type HttpRateLimitAuthorityResolution =
	| Readonly<{
			hash: string;
			matched: true;
			origin: string;
			declaration: PluginHttpRateLimit;
	  }>
	| Readonly<{
			matched: false;
			origin?: string;
			reason: "invalid-url" | "non-http-url" | "undeclared-origin";
	  }>;

const requestOrigin = (requestUrl: string) => {
	const parsed = Result.try(() => new URL(requestUrl));
	if (Result.isFailure(parsed)) {
		return { matched: false as const, reason: "invalid-url" as const };
	}
	if (parsed.success.protocol !== "http:" && parsed.success.protocol !== "https:") {
		return { matched: false as const, reason: "non-http-url" as const };
	}
	return { origin: parsed.success.origin };
};

export class PluginHttpRateLimitAuthority extends Context.Service<PluginHttpRateLimitAuthority>()(
	"PluginHttpRateLimitAuthority",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* PluginRepository;
			const resolve: (
				requestUrl: string,
			) => Effect.Effect<HttpRateLimitAuthorityResolution, DbError | PluginValidationError> =
				Effect.fn("PluginHttpRateLimitAuthority.resolve")(function* (requestUrl: string) {
					const requested = requestOrigin(requestUrl);
					if (!("origin" in requested)) {
						return requested satisfies HttpRateLimitAuthorityResolution;
					}
					const manifests = yield* runWithDb(repository.listActiveManifests());
					const lookups = yield* Effect.try({
						try: () => buildHttpRateLimitLookups(manifests),
						catch: (error) => new PluginValidationError({ issues: [String(error)] }),
					});
					const policy = lookups.byOrigin[requested.origin];
					return policy
						? ({ matched: true, origin: requested.origin, ...policy } as const)
						: ({ matched: false, origin: requested.origin, reason: "undeclared-origin" } as const);
				});
			return { resolve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
