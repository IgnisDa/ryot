import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect } from "effect";

import {
	adminHeaders,
	type Client,
	findBuiltinSchemaBySlug,
	getApiClient,
	installTestPluginBundle,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";

import {
	benchmarkBookDetailsSource,
	benchmarkBookSearchSource,
	benchmarkPersonDetailsSource,
	benchmarkScriptSource,
} from "./workload-sources";

export const BENCHMARK_RELATED_RELATIONSHIP_SLUG = "person-to-book";
export const BENCHMARK_SUGGESTION_RELATIONSHIP_SLUG = "media-suggestion";

/** Run IDs are UTC timestamps, and plugin manifest slugs accept only lowercase kebab segments. */
export const benchmarkSlugSegment = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/**
 * One private plugin per run carries every hermetic workload: a generic script for direct sandbox
 * scenarios and a book/person provider pair for full-import scenarios.
 */
export const installBenchmarkWorkloadPlugin = (input: {
	readonly client: Client;
	readonly runId: string;
}) =>
	Effect.gen(function* () {
		const pluginSlug = `sandbox-resource-baseline-${benchmarkSlugSegment(input.runId)}`;
		const scriptSlug = `${pluginSlug}.script`;
		const bookProviderSlug = `book.${pluginSlug}`;
		const personProviderSlug = `person.${pluginSlug}`;
		const [{ schema: bookSchema }, { schema: personSchema }] = yield* Effect.all([
			findBuiltinSchemaBySlug(input.client, "book"),
			findBuiltinSchemaBySlug(input.client, "person"),
		]);
		const scripts = [
			{
				slug: scriptSlug,
				kind: "script" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "Benchmark hermetic script",
				entry: "backend/scripts/hermetic.sandbox.ts",
				capabilities: ["getUserPreferences", "setCachedValue"],
			},
			{
				kind: "provider" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				providerSlug: bookProviderSlug,
				name: "Benchmark book details",
				slug: `${bookProviderSlug}.details`,
				providerOperation: "details" as const,
				capabilities: ["getUserPreferences", "setCachedValue"],
				entry: `backend/providers/${bookProviderSlug}/details.sandbox.ts`,
			},
			{
				capabilities: [],
				kind: "provider" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "Benchmark book search",
				providerSlug: bookProviderSlug,
				slug: `${bookProviderSlug}.search`,
				providerOperation: "search" as const,
				entry: `backend/providers/${bookProviderSlug}/search.sandbox.ts`,
			},
			{
				capabilities: [],
				kind: "provider" as const,
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				providerSlug: personProviderSlug,
				name: "Benchmark person details",
				slug: `${personProviderSlug}.details`,
				providerOperation: "details" as const,
				entry: `backend/providers/${personProviderSlug}/details.sandbox.ts`,
			},
		] satisfies PluginManifest["scripts"];
		const installed = yield* installTestPluginBundle({
			scripts,
			pluginSlug,
			client: input.client,
			providers: [
				{
					slug: bookProviderSlug,
					name: "Benchmark book provider",
					rootEntitySchemaSlug: bookSchema.id,
					information: { source: "sandbox-resource-baseline" },
					operations: {
						search: `${bookProviderSlug}.search`,
						details: `${bookProviderSlug}.details`,
					},
				},
				{
					slug: personProviderSlug,
					name: "Benchmark person provider",
					rootEntitySchemaSlug: personSchema.id,
					information: { source: "sandbox-resource-baseline" },
					operations: { details: `${personProviderSlug}.details` },
				},
			],
			files: {
				"backend/scripts/hermetic.sandbox.ts": benchmarkScriptSource({
					slug: scriptSlug,
					name: "Benchmark hermetic script",
				}),
				[`backend/providers/${bookProviderSlug}/search.sandbox.ts`]: benchmarkBookSearchSource({
					name: "Benchmark book search",
					slug: `${bookProviderSlug}.search`,
				}),
				[`backend/providers/${personProviderSlug}/details.sandbox.ts`]:
					benchmarkPersonDetailsSource({
						name: "Benchmark person details",
						slug: `${personProviderSlug}.details`,
					}),
				[`backend/providers/${bookProviderSlug}/details.sandbox.ts`]: benchmarkBookDetailsSource({
					bookProviderSlug,
					personProviderSlug,
					name: "Benchmark book details",
					slug: `${bookProviderSlug}.details`,
					suggestionRelationshipSlug: BENCHMARK_SUGGESTION_RELATIONSHIP_SLUG,
					relatedEntityRelationshipSlug: BENCHMARK_RELATED_RELATIONSHIP_SLUG,
				}),
			},
		});
		const scriptId = requirePresent(
			installed.scriptIds[scriptSlug],
			"Benchmark hermetic script was not installed",
		);
		const bookDetailsScriptId = requirePresent(
			installed.scriptIds[`${bookProviderSlug}.details`],
			"Benchmark book details script was not installed",
		);
		const storedBookDetails = yield* getApiClient().call(
			(client) =>
				client.testSupport.getSandboxScript({ params: { scriptId: bookDetailsScriptId } }),
			adminHeaders(),
		);
		const bookProviderId = requirePresent(
			storedBookDetails.providerId,
			"Benchmark book provider ID was not returned by test support",
		);
		return { scriptId, installed, pluginSlug, bookProviderId, bookProviderSlug };
	});

export type BenchmarkWorkloadPlugin = Effect.Success<
	ReturnType<typeof installBenchmarkWorkloadPlugin>
>;
