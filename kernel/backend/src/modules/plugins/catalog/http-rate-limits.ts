import { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	type DefinitionOwner,
	identityTupleKey,
} from "@ryot-app/contract/modules/plugins/references";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";

// Origin policies key admission by origin identity, which is not an authored manifest slug.
export const HttpRateLimitPolicyDeclaration = Schema.Struct({
	...PluginHttpRateLimit.fields,
	key: Schema.String,
});
export type HttpRateLimitPolicyDeclaration = typeof HttpRateLimitPolicyDeclaration.Type;

export type CanonicalHttpRateLimitPolicy = Readonly<{
	hash: string;
	declaration: HttpRateLimitPolicyDeclaration;
}>;

export type HttpRateLimitLookups = Readonly<{
	byKey: Readonly<Record<string, CanonicalHttpRateLimitPolicy>>;
	byOrigin: Readonly<Record<string, CanonicalHttpRateLimitPolicy>>;
}>;

// The URL parser lowercases hosts, drops default ports and canonicalizes IP literals, but keeps
// a fully qualified name's trailing dot, which reaches the same host.
export const canonicalOrigin = (url: URL) => {
	url.hostname = url.hostname.replace(/\.+$/, "");
	return url.origin;
};
const hashCanonicalDeclaration = (declaration: PluginHttpRateLimit) =>
	sha256Hex(
		stableStringify({ requests: declaration.requests, intervalMs: declaration.intervalMs }),
	);

const canonicalizeHttpRateLimitDeclaration = (declaration: PluginHttpRateLimit) =>
	({
		key: declaration.key,
		requests: declaration.requests,
		intervalMs: declaration.intervalMs,
		origins: declaration.origins.map((origin) => canonicalOrigin(new URL(origin))).sort(),
	}) satisfies PluginHttpRateLimit;

export const buildHttpRateLimitLookups = (
	plugins: ReadonlyArray<{
		readonly owner: DefinitionOwner;
		readonly packageId: string;
		readonly httpRateLimits: ReadonlyArray<PluginHttpRateLimit>;
	}>,
): HttpRateLimitLookups => {
	const ownerByKey = new Map<string, string>();
	const ownerByOrigin = new Map<string, string>();
	const byKey: Record<string, CanonicalHttpRateLimitPolicy> = {};
	const byOrigin: Record<string, CanonicalHttpRateLimitPolicy> = {};
	for (const plugin of plugins) {
		for (const declaration of plugin.httpRateLimits) {
			const canonical = canonicalizeHttpRateLimitDeclaration(declaration);
			const policy = { declaration: canonical, hash: hashCanonicalDeclaration(canonical) };
			const key = definitionKey("http-rate-limit", plugin.owner, canonical.key);
			const keyed = byKey[key];
			if (keyed && stableStringify(keyed.declaration) !== stableStringify(canonical)) {
				throw new Error(
					`Conflicting HTTP rate limit key '${canonical.key}' in active plugins '${ownerByKey.get(key)}' and '${plugin.packageId}'`,
				);
			}
			for (const origin of canonical.origins) {
				const originated = byOrigin[origin];
				if (originated && originated.hash !== policy.hash) {
					throw new Error(
						`Conflicting HTTP rate limit origin '${origin}' in active plugins '${ownerByOrigin.get(origin)}' and '${plugin.packageId}'`,
					);
				}
			}
			byKey[key] = policy;
			ownerByKey.set(key, plugin.packageId);
			for (const origin of canonical.origins) {
				byOrigin[origin] = {
					...policy,
					declaration: {
						...canonical,
						origins: [origin],
						key: identityTupleKey("http-origin", origin),
					},
				};
				ownerByOrigin.set(origin, plugin.packageId);
			}
		}
	}
	return { byKey, byOrigin };
};
