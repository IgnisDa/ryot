import type { DbError } from "@ryot-app/contract/errors";
import type { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import { Context, Effect, Layer, Result } from "effect";

import { buildHttpRateLimitLookups } from "./http-rate-limits";
import { PluginRepository } from "./repository";
import { PluginValidationError } from "./validation";

export type HttpRateLimitAuthorityResolution =
	| Readonly<{ hash: string; matched: true; origin: string; declaration: PluginHttpRateLimit }>
	| Readonly<{
			matched: false;
			origin?: string;
			reason: "invalid-url" | "non-http-url" | "undeclared-origin";
	  }>;

const requestOrigin = (
	requestUrl: string,
):
	| Readonly<{ matched: false; reason: "invalid-url" | "non-http-url" }>
	| Readonly<{ origin: string }> => {
	const parsed = Result.try(() => new URL(requestUrl));
	if (Result.isFailure(parsed)) {
		return { matched: false, reason: "invalid-url" };
	}
	if (parsed.success.protocol !== "http:" && parsed.success.protocol !== "https:") {
		return { matched: false, reason: "non-http-url" };
	}
	// The URL parser lowercases hosts, drops default ports and canonicalizes IP literals, but keeps
	// a fully qualified name's trailing dot, which reaches the same host.
	const hostname = parsed.success.hostname.replace(/\.+$/, "");
	if (hostname.length === 0) {
		return { matched: false, reason: "invalid-url" };
	}
	parsed.success.hostname = hostname;
	return { origin: parsed.success.origin };
};

export class PluginHttpRateLimitAuthority extends Context.Service<PluginHttpRateLimitAuthority>()(
	"PluginHttpRateLimitAuthority",
	{
		make: Effect.gen(function* () {
			const repository = yield* PluginRepository;
			const resolve: (
				requestUrl: string,
			) => Effect.Effect<HttpRateLimitAuthorityResolution, DbError | PluginValidationError> =
				Effect.fn("PluginHttpRateLimitAuthority.resolve")(function* (requestUrl: string) {
					const requested = requestOrigin(requestUrl);
					if (!("origin" in requested)) {
						return requested satisfies HttpRateLimitAuthorityResolution;
					}
					const declarations = yield* repository.listActiveHttpRateLimits();
					const lookups = yield* Effect.try({
						try: () => buildHttpRateLimitLookups(declarations),
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
