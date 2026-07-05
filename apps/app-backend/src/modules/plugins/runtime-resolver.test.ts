import { expect, it } from "@effect/vitest";
import { SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { assert } from "vitest";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRuntimeResolver, UnsupportedProviderOperationError } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const providerId = SandboxProviderId.make("provider-id");

const normalizedPlugin = (): NormalizedPlugin => {
	const manifest = fixtureManifest();
	const automation = manifest.scripts[0];
	assert(automation);
	const details = {
		...automation,
		kind: "provider" as const,
		name: "Fixture details",
		slug: "fixture.details",
		providerSlug: "fixture-provider",
		providerOperation: "details" as const,
	};
	const search = {
		...automation,
		kind: "provider" as const,
		name: "Fixture search",
		slug: "fixture.search",
		providerSlug: "fixture-provider",
		providerOperation: "search" as const,
	};
	const preload = {
		...automation,
		kind: "script" as const,
		name: "Fixture preload",
		slug: "fixture.preload",
		providerSlug: "fixture-provider",
	};
	const normalizedManifest: PluginManifest = {
		...manifest,
		scripts: [...manifest.scripts, details, search, preload],
		providers: [
			{
				name: "Fixture provider",
				slug: "fixture-provider",
				information: { source: "fixture" },
				operations: { details: details.slug, search: search.slug },
			},
		],
		bindings: {
			...manifest.bindings,
			schemaProviderLinks: [
				{ providerSlug: "fixture-provider", entitySchemaSlug: "fixture-entity" },
			],
		},
	};
	return {
		manifest: normalizedManifest,
		sourceHash: "source-hash",
		scripts: normalizedManifest.scripts.map((script) => {
			const { entry, ...metadata } = script;
			return {
				entry,
				metadata,
				slug: script.slug,
				name: script.name,
				source: "source",
				compiledFormat: 1,
				compiledCode: "compiled",
				contentHash: `${script.slug}-hash`,
			};
		}),
	};
};

const providerRow = {
	id: providerId,
	name: "Fixture provider",
	slug: "fixture-provider",
	pluginSlug: "fixture",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "fixture" },
};

const scriptRow = {
	name: "Fixture details",
	source: "source",
	pluginSlug: "fixture",
	providerId,
	compiledFormat: 1,
	compiledCode: "compiled",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	id: SandboxScriptId.make("details-script-id"),
	slug: "fixture.details",
	contentHash: "fixture.details-hash",
	metadata: {
		capabilities: [],
		kind: "provider" as const,
		name: "Fixture details",
		slug: "fixture.details",
		requiredAppConfigKeys: [],
	},
};

const customScriptRow = {
	...scriptRow,
	name: "Fixture preload",
	slug: "fixture.preload",
	id: SandboxScriptId.make("preload-script-id"),
	contentHash: "fixture.preload-hash",
	metadata: {
		capabilities: [],
		kind: "script" as const,
		name: "Fixture preload",
		slug: "fixture.preload",
		requiredAppConfigKeys: [],
	},
};

const makeLayer = () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin());
	let scriptSelectCount = 0;
	const db = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () => {
						if (table === schema.sandboxProvider) {
							return Promise.resolve([providerRow]);
						}
						scriptSelectCount += 1;
						return Promise.resolve(scriptSelectCount === 3 ? [customScriptRow] : [scriptRow]);
					},
				}),
			}),
		}),
	};
	return PluginRuntimeResolver.Default.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader }),
				Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
			),
		),
	);
};

it.effect("resolves active schema providers and their operation-specific scripts", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const schemaProvider = yield* resolver.findSchemaProviderBySlug("fixture-provider");
		expect(schemaProvider).toMatchObject({
			entitySchemaSlug: "fixture-entity",
			provider: { id: providerId, slug: "fixture-provider" },
		});
		expect(yield* resolver.findDetailsScript(providerId)).toMatchObject({
			id: "details-script-id",
			slug: "fixture.details",
		});
		expect(yield* resolver.resolveDetailsScript(providerId)).toMatchObject({
			id: "details-script-id",
			slug: "fixture.details",
		});
		expect(yield* resolver.findActiveScript("fixture.preload")).toMatchObject({
			providerId,
			id: "preload-script-id",
			slug: "fixture.preload",
		});
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("returns a contextual typed failure for an unsupported operation", () =>
	Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const exit = yield* Effect.exit(resolver.resolveTranslateScript(providerId));
		assert(Exit.isFailure(exit));
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(UnsupportedProviderOperationError);
		expect(error).toMatchObject({
			providerId,
			operation: "translate",
			providerSlug: "fixture-provider",
			reason: "unsupported_operation",
		});
	}).pipe(Effect.provide(makeLayer())),
);
