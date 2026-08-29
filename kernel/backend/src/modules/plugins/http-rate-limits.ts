import type { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
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

const normalizeOrigin = (origin: string) => new URL(origin).origin;
const hashCanonicalDeclaration = (declaration: PluginHttpRateLimit) =>
	sha256Hex(stableStringify(declaration));

const canonicalizeHttpRateLimitDeclaration = (declaration: PluginHttpRateLimit) =>
	({
		key: declaration.key,
		requests: declaration.requests,
		intervalMs: declaration.intervalMs,
		origins: declaration.origins.map(normalizeOrigin).sort(),
	}) satisfies PluginHttpRateLimit;

export const buildHttpRateLimitLookups = (
	plugins: ReadonlyArray<{
		readonly slug: string;
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
			const keyed = byKey[canonical.key];
			if (keyed && keyed.hash !== policy.hash) {
				throw new Error(
					`Conflicting HTTP rate limit key '${canonical.key}' in active plugins '${ownerByKey.get(canonical.key)}' and '${plugin.slug}'`,
				);
			}
			for (const origin of canonical.origins) {
				const originated = byOrigin[origin];
				if (originated && originated.hash !== policy.hash) {
					throw new Error(
						`Conflicting HTTP rate limit origin '${origin}' in active plugins '${ownerByOrigin.get(origin)}' and '${plugin.slug}'`,
					);
				}
			}
			byKey[canonical.key] = policy;
			ownerByKey.set(canonical.key, plugin.slug);
			for (const origin of canonical.origins) {
				byOrigin[origin] = policy;
				ownerByOrigin.set(origin, plugin.slug);
			}
		}
	}
	return { byKey, byOrigin };
};
