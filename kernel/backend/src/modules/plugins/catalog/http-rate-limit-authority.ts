import type { DbError } from "@ryot-app/contract/errors";
import { Context, Effect, Layer, Result } from "effect";

import { PluginRepository } from "../packages/repository";
import { PluginValidationError } from "../packages/validation";
import {
	buildHttpRateLimitLookups,
	canonicalOrigin,
	type HttpRateLimitPolicyDeclaration,
} from "./http-rate-limits";

export type HttpRateLimitAuthorityResolution =
	| Readonly<{
			hash: string;
			matched: true;
			origin: string;
			declaration: HttpRateLimitPolicyDeclaration;
	  }>
	| Readonly<{
			matched: false;
			origin?: string;
			reason: "invalid-url" | "non-http-url" | "undeclared-origin";
	  }>;

const requestOrigin = (
	requestUrl: string,
):
	| Readonly<{ origin: string }>
	| Readonly<{ matched: false; reason: "invalid-url" | "non-http-url" }> => {
	const parsed = Result.try(() => new URL(requestUrl));
	if (Result.isFailure(parsed)) {
		return { matched: false, reason: "invalid-url" };
	}
	if (parsed.success.protocol !== "http:" && parsed.success.protocol !== "https:") {
		return { matched: false, reason: "non-http-url" };
	}
	if (/^\.+$/.test(parsed.success.hostname)) {
		return { matched: false, reason: "invalid-url" };
	}
	return { origin: canonicalOrigin(parsed.success) };
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
