import type { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	cacheSandboxSource,
	createAuthenticatedClient,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	installTestPluginBundle,
	pollSandboxResult,
	requireCompletedSandboxValue,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertPresent, requireArray, requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const providerCacheSource = (input: {
	key: string;
	slug: string;
	name: string;
	value: string;
	operation: "details" | "search";
}) => `
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
  capabilities: [${JSON.stringify(input.operation === "details" ? "setCachedValue" : "getCachedValue")}],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineProvider({
  manifest,
  operation: ${JSON.stringify(input.operation)},
  run: ${
		input.operation === "details"
			? `({ externalId }, host) => Effect.gen(function* () {
    yield* host.setCachedValue(${JSON.stringify(input.key)}, ${JSON.stringify(input.value)}, 60);
    return { name: externalId, properties: {} };
  })`
			: `(_input, host) => Effect.gen(function* () {
    const data = yield* host.getCachedValue(${JSON.stringify(input.key)});
    return {
      items: typeof data === "string"
        ? [{ externalId: "cached", titleProperty: { kind: "text", value: data } }]
        : [],
    };
  })`
	},
});
`;

const installCacheProviderScoped = (key: string, value: string) => {
	const providerSlug = `cache-provider-${crypto.randomUUID()}`;
	const writerSlug = `${providerSlug}.details`;
	const readerSlug = `${providerSlug}.search`;
	const writerEntry = `scripts/${writerSlug}.sandbox.ts`;
	const readerEntry = `scripts/${readerSlug}.sandbox.ts`;
	return Effect.acquireRelease(
		installTestPluginBundle({
			configSchema: { fields: {}, unknownKeys: "strict" },
			files: {
				[writerEntry]: providerCacheSource({
					key,
					value,
					slug: writerSlug,
					operation: "details",
					name: "Cache writer",
				}),
				[readerEntry]: providerCacheSource({
					key,
					value,
					slug: readerSlug,
					operation: "search",
					name: "Cache reader",
				}),
			},
			scripts: [
				{
					providerSlug,
					kind: "provider",
					slug: writerSlug,
					entry: writerEntry,
					name: "Cache writer",
					requiredPluginConfigKeys: [],
					requiredSystemConfigKeys: [],
					providerOperation: "details",
					capabilities: ["setCachedValue"],
				},
				{
					providerSlug,
					kind: "provider",
					slug: readerSlug,
					entry: readerEntry,
					name: "Cache reader",
					requiredPluginConfigKeys: [],
					requiredSystemConfigKeys: [],
					providerOperation: "search",
					capabilities: ["getCachedValue"],
				},
			],
			providers: [
				{
					slug: providerSlug,
					name: "Cache provider",
					information: { source: "e2e" },
					operations: { details: writerSlug, search: readerSlug },
				},
			],
		}),
		uninstallTestPlugin,
	);
};

const readProviderCache = (userId: string, scriptId: SandboxScriptId) =>
	Effect.gen(function* () {
		const { jobId } = yield* enqueueSandboxScript(userId, {
			scriptId,
			context: { page: 1, pageSize: 1, query: "cache" },
		});
		const result = requireObjectRecord(
			requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
			"Expected provider cache read result to be an object",
		);
		return requireArray(result.items, "Expected provider cache items to be an array");
	});

describe("sandbox cache functions", () => {
	it.live(
		"setCachedValue stores a value that getCachedValue retrieves within the same script",
		() =>
			Effect.gen(function* () {
				const { userId } = yield* createAuthenticatedClient();
				const cacheKey = `cache-test-${crypto.randomUUID()}`;
				const slug = `cache-round-trip-${crypto.randomUUID()}`;
				const { scriptId } = yield* installSandboxScriptScoped({
					slug,
					name: "cache-round-trip",
					capabilities: ["setCachedValue", "getCachedValue"],
					source: cacheSandboxSource({
						slug,
						key: cacheKey,
						ttlSeconds: 60,
						value: { value: 42 },
						operation: "roundTrip",
						name: "cache-round-trip",
					}),
				});
				const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

				const value = requireObjectRecord(
					requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
					"Expected cache write result to be an object",
				);
				expect(value.success).toBe(true);
				expect(value.data).toEqual({ value: 42 });
			}),
	);

	it.live("getCachedValue returns null for a key that was never set", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const missingKey = `cache-missing-${crypto.randomUUID()}`;
			const slug = `cache-miss-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "cache-miss",
				capabilities: ["getCachedValue"],
				source: cacheSandboxSource({ slug, key: missingKey, operation: "get", name: "cache-miss" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
				"Expected cache miss result to be an object",
			);
			expect(value.success).toBe(true);
			expect(value.data).toBeNull();
		}),
	);

	it.live("provider scripts share cache while users and providers remain isolated", () =>
		Effect.gen(function* () {
			const { userId: userIdA } = yield* createAuthenticatedClient();
			const { userId: userIdB } = yield* createAuthenticatedClient();
			const key = `provider-cache-${crypto.randomUUID()}`;
			const cachedValue = `private-${crypto.randomUUID()}`;
			const providerA = yield* installCacheProviderScoped(key, cachedValue);
			const providerB = yield* installCacheProviderScoped(key, "other-provider-value");
			const writerScriptId =
				providerA.scriptIds[providerA.manifest.providers[0]?.operations.details ?? ""];
			const readerScriptId =
				providerA.scriptIds[providerA.manifest.providers[0]?.operations.search ?? ""];
			const otherProviderReaderScriptId =
				providerB.scriptIds[providerB.manifest.providers[0]?.operations.search ?? ""];
			assertPresent(writerScriptId, "Expected provider cache writer script ID");
			assertPresent(readerScriptId, "Expected provider cache reader script ID");
			assertPresent(otherProviderReaderScriptId, "Expected other provider cache reader script ID");
			expect(writerScriptId).not.toBe(readerScriptId);

			const { jobId: writeJobId } = yield* enqueueSandboxScript(userIdA, {
				scriptId: writerScriptId,
				context: { externalId: "cache-writer" },
			});
			requireCompletedSandboxValue(yield* pollSandboxResult(userIdA, writeJobId));

			const sharedItems = yield* readProviderCache(userIdA, readerScriptId);
			const sharedItem = requireObjectRecord(sharedItems[0], "Expected provider cache item");
			const title = requireObjectRecord(sharedItem.titleProperty, "Expected cache item title");
			expect(title.value).toBe(cachedValue);
			expect(yield* readProviderCache(userIdB, readerScriptId)).toEqual([]);
			expect(yield* readProviderCache(userIdA, otherProviderReaderScriptId)).toEqual([]);
		}),
	);
});
