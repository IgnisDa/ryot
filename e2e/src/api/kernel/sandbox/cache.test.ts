import type { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	cacheSandboxSource,
	createAuthenticatedClient,
	enqueueSandboxScript,
	type Client,
	installSandboxScriptScoped,
	installTestPluginBundle,
	pollSandboxResult,
	requireCompletedSandboxValue,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertPresent, requireArray, requireObjectRecord } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const providerCacheSource = (input: {
	key: string;
	slug: string;
	name: string;
	value: string;
	operation: "details" | "search";
}) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

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
        ? [{ externalId: "cached", title: data }]
        : [],
    };
  })`
	},
});
`;

const installCacheProviderScoped = (client: Client, key: string, value: string) => {
	const providerSlug = `cache-provider-${crypto.randomUUID()}`;
	const entitySchemaSlug = `${providerSlug}-entity`;
	const writerSlug = `${providerSlug}.details`;
	const readerSlug = `${providerSlug}.search`;
	const writerEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
	const readerEntry = `backend/providers/${providerSlug}/search.sandbox.ts`;
	return Effect.acquireRelease(
		installTestPluginBundle({
			client,
			configSchema: { fields: {}, unknownKeys: "strict" },
			entitySchemas: [
				{
					icon: "box",
					eventSchemas: [],
					name: "Cache entity",
					slug: entitySchemaSlug,
					propertiesSchema: { fields: {}, unknownKeys: "strict" },
				},
			],
			providers: [
				{
					slug: providerSlug,
					name: "Cache provider",
					information: { source: "e2e" },
					rootEntitySchemaSlug: entitySchemaSlug,
					operations: { search: readerSlug, details: writerSlug },
				},
			],
			files: {
				[readerEntry]: providerCacheSource({
					key,
					value,
					slug: readerSlug,
					operation: "search",
					name: "Cache reader",
				}),
				[writerEntry]: providerCacheSource({
					key,
					value,
					slug: writerSlug,
					operation: "details",
					name: "Cache writer",
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
					providerOperation: "search",
					requiredPluginConfigKeys: [],
					requiredSystemConfigKeys: [],
					capabilities: ["getCachedValue"],
				},
			],
		}),
		uninstallTestPlugin,
	);
};

const runProviderCache = (userId: string, scriptId: SandboxScriptId) =>
	Effect.gen(function* () {
		const { jobId } = yield* enqueueSandboxScript(userId, {
			scriptId,
			context: { page: 1, pageSize: 1, query: "cache" },
		});
		return yield* pollSandboxResult(userId, jobId);
	});

const readProviderCache = (userId: string, scriptId: SandboxScriptId) =>
	Effect.gen(function* () {
		const result = requireObjectRecord(
			requireCompletedSandboxValue(yield* runProviderCache(userId, scriptId)),
			"Expected provider cache read result to be an object",
		);
		return requireArray(result.items, "Expected provider cache items to be an array");
	});

describe("sandbox cache functions", () => {
	it.live(
		"setCachedValue stores a value that getCachedValue retrieves within the same script",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const cacheKey = `cache-test-${crypto.randomUUID()}`;
				const slug = `cache-round-trip-${crypto.randomUUID()}`;
				const { scriptId } = yield* installSandboxScriptScoped({
					slug,
					client,
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
			const { client, userId } = yield* createAuthenticatedClient();
			const missingKey = `cache-missing-${crypto.randomUUID()}`;
			const slug = `cache-miss-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
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

	it.live("claimPersistentValue persists an atomic claim across executions", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const cacheKey = `persistent-cache-test-${crypto.randomUUID()}`;
			const slug = `persistent-cache-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "persistent-cache",
				capabilities: ["claimPersistentValue"],
				source: cacheSandboxSource({
					slug,
					key: cacheKey,
					ttlSeconds: 60,
					name: "persistent-cache",
					operation: "claimPersistent",
					value: { owner: "first-execution" },
				}),
			});

			const first = yield* enqueueSandboxScript(userId, { scriptId });
			const firstValue = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, first.jobId)),
				"Expected first persistent claim result to be an object",
			);
			expect(firstValue.data).toEqual({ claimed: true });

			const second = yield* enqueueSandboxScript(userId, { scriptId });
			const secondValue = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, second.jobId)),
				"Expected second persistent claim result to be an object",
			);
			expect(secondValue.data).toEqual({ claimed: false, value: { owner: "first-execution" } });
		}),
	);

	it.live("provider scripts share cache while users and providers remain isolated", () =>
		Effect.gen(function* () {
			const { client: clientA, userId: userIdA } = yield* createAuthenticatedClient();
			const { client: clientB, userId: userIdB } = yield* createAuthenticatedClient();
			const key = `provider-cache-${crypto.randomUUID()}`;
			const cachedValue = `private-${crypto.randomUUID()}`;
			const providerA = yield* installCacheProviderScoped(clientA, key, cachedValue);
			const providerB = yield* installCacheProviderScoped(clientB, key, "other-provider-value");
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
			expect(sharedItem.title).toBe(cachedValue);
			expect(yield* readProviderCache(userIdB, otherProviderReaderScriptId)).toEqual([]);

			const foreignUserResult = yield* runProviderCache(userIdB, readerScriptId);
			const foreignProviderResult = yield* runProviderCache(userIdA, otherProviderReaderScriptId);
			expect(foreignUserResult).toMatchObject({
				status: "failed",
				error: expect.stringContaining("plugin owner does not match execution user"),
			});
			expect(foreignProviderResult).toMatchObject({
				status: "failed",
				error: expect.stringContaining("plugin owner does not match execution user"),
			});
		}),
	);
});
