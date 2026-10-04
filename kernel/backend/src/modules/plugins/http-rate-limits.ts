import type { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	identityTupleKey,
	type DefinitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";

export type CanonicalHttpRateLimitPolicy = Readonly<{
	hash: string;
	declaration: PluginHttpRateLimit;
}>;

export type HttpRateLimitLookups = Readonly<{
	byKey: Readonly<Record<string, CanonicalHttpRateLimitPolicy>>;
	byOrigin: Readonly<Record<string, CanonicalHttpRateLimitPolicy>>;
}>;

const normalizeOrigin = (origin: string) => {
	const url = new URL(origin);
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
		origins: declaration.origins.map(normalizeOrigin).sort(),
	}) satisfies PluginHttpRateLimit;

export const buildHttpRateLimitLookups = (
	plugins: ReadonlyArray<{
		readonly owner: DefinitionOwner;
		readonly scope: "system" | "user";
		readonly packageId: string;
		readonly httpRateLimits: ReadonlyArray<PluginHttpRateLimit>;
	}>,
): HttpRateLimitLookups => {
	const ownerByKey = new Map<string, string>();
	const ownerByOrigin = new Map<string, string>();
	const byKey: Record<string, CanonicalHttpRateLimitPolicy> = {};
	const byOrigin: Record<string, CanonicalHttpRateLimitPolicy> = {};
	for (const plugin of plugins) {
		if (plugin.scope === "user" && plugin.httpRateLimits.length > 0) {
			throw new Error("Private plugins cannot declare deployment HTTP policies");
		}
		if (plugin.owner.kind === "kernel") {
			throw new Error("Deployment HTTP policies require a plugin owner");
		}
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
