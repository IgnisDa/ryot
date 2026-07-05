import { expect, it } from "@effect/vitest";
import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

const select = () => ({
	from: () => ({
		where: () => ({
			limit: () =>
				Promise.resolve([
					{ id: "sandbox-script-id", slug: "fixture.provider", contentHash: "hash" },
				]),
		}),
	}),
});

const makeLayer = () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	return PluginRuntimeResolver.Default.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader }),
				Layer.succeed(CurrentDb, Object.assign(Object.create(null), { select })),
			),
		),
	);
};

it.effect("returns the existing sandbox script link on conflict", () => {
	const input = {
		entitySchemaSlug: EntitySchemaSlug.make("movie"),
		sandboxScriptId: SandboxScriptId.make("sandbox-script-id"),
	};

	return Effect.gen(function* () {
		const resolver = yield* PluginRuntimeResolver;
		const created = yield* resolver.registerTestSchemaScript(input);
		const existing = yield* resolver.registerTestSchemaScript(input);
		expect(created).toEqual({ id: "movie:fixture.provider" });
		expect(existing).toEqual(created);
	}).pipe(Effect.provide(makeLayer()));
});
