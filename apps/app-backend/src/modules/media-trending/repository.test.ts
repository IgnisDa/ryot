import { expect, it } from "@effect/vitest";
import type { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";
import type { MockOverrides } from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { MediaTrendingRepository } from "./repository";

const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);

const makePluginRuntime = (overrides: MockOverrides<typeof mockPluginRuntime> = {}) =>
	mockPluginRuntime({ _tag: "PluginRuntimeResolver", ...overrides });

const makeScriptRow = (input: { slug: string; metadata: SandboxScriptMetadata }) => ({
	source: "",
	compiledCode: "",
	slug: input.slug,
	name: input.slug,
	compiledFormat: 1,
	pluginSlug: "media",
	metadata: input.metadata,
	contentHash: `hash-${input.slug}`,
	id: SandboxScriptId.make(`script-${input.slug}`),
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

it.effect("keeps only schema-linked scripts that declare a trending driver", () => {
	const trendingScript = makeScriptRow({
		slug: "movie.tmdb",
		metadata: { driverNames: ["search", "details", "resolve", "translate", "trending"] },
	});
	const nonTrendingScript = makeScriptRow({
		slug: "movie.tvdb",
		metadata: { driverNames: ["search", "details", "resolve", "translate"] },
	});
	const undeclaredScript = makeScriptRow({ slug: "movie.legacy", metadata: {} });
	const movieSchemaSlug = EntitySchemaSlug.make("movie");
	const layer = Layer.mergeAll(
		MediaTrendingRepository.Default.pipe(
			Layer.provide(
				makePluginRuntime({
					listSchemaScripts: () =>
						Effect.succeed([
							{ entitySchemaSlug: movieSchemaSlug, script: trendingScript },
							{ entitySchemaSlug: movieSchemaSlug, script: nonTrendingScript },
							{ entitySchemaSlug: movieSchemaSlug, script: undeclaredScript },
						]),
				}),
			),
		),
		Layer.succeed(CurrentDb, Object.create(null)),
	);

	return Effect.gen(function* () {
		const repository = yield* MediaTrendingRepository;
		const targets = yield* repository.listProviderTargets();

		expect(targets).toEqual([
			{
				scriptSlug: "movie.tmdb",
				scriptId: trendingScript.id,
				entitySchemaSlug: movieSchemaSlug,
			},
		]);
	}).pipe(Effect.provide(layer));
});
