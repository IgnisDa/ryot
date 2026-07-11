import { expect, it } from "@effect/vitest";
import type { SandboxExecutionPayload } from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { dbRunnerLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { NormalizedPlugin } from "#modules/plugins/types";

import { makePluginUserBootstrapDispatcher, userBootstrapExecutionId } from "./plugin-dispatch";

const normalizedPlugin = (
	pluginSlug: string,
	entries: PluginManifest["userBootstrap"],
): NormalizedPlugin => {
	const base = fixtureManifest();
	const declared = base.scripts[0];
	assert(declared);
	const scripts = entries.map((entry) => ({
		...declared,
		slug: entry.scriptSlug,
		kind: "script" as const,
		name: entry.description,
		entry: `${entry.scriptSlug}.sandbox.ts`,
	}));
	const manifest: PluginManifest = {
		...base,
		scripts,
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		userBootstrap: entries,
		relationshipSchemas: [],
		metadata: { ...base.metadata, slug: pluginSlug },
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			schemaProviderLinks: [],
			relationshipAutomations: [],
		},
	};
	return {
		manifest,
		sourceHash: `${pluginSlug}-source`,
		scripts: scripts.map(({ entry, ...metadata }) => ({
			entry,
			metadata,
			source: "source",
			compiledFormat: 1,
			slug: metadata.slug,
			name: metadata.name,
			compiledCode: "compiled",
			contentHash: `${metadata.slug}-hash`,
		})),
	};
};

const loader = makePluginLoader(makeDefinitionRegistry());
loader.load(
	normalizedPlugin("media", [
		{ slug: "second", scriptSlug: "bootstrap.second", description: "Second" },
		{ slug: "first", scriptSlug: "bootstrap.first", description: "First" },
	]),
);
loader.load(
	normalizedPlugin("untrusted", [
		{ slug: "ignored", scriptSlug: "bootstrap.ignored", description: "Ignored" },
	]),
);

type ActiveScript = NonNullable<
	Effect.Effect.Success<ReturnType<PluginRuntimeResolver["findActiveScript"]>>
>;

const layer = Layer.mergeAll(
	dbRunnerLayer,
	Layer.succeed(PluginLoader, {
		_tag: "PluginLoader",
		...loader,
	}),
	Layer.mock(PluginRuntimeResolver)({
		_tag: "PluginRuntimeResolver",
		resolveActivePluginUserBootstrap: ({ bootstrapSlug, pluginSlug }) => {
			const bootstrap = loader
				.getSnapshot()
				.plugins[pluginSlug]?.manifest.userBootstrap.find(({ slug }) => slug === bootstrapSlug);
			return bootstrap
				? Effect.succeed({
						bootstrap,
						script: {
							pluginSlug,
							source: "source",
							providerId: null,
							compiledFormat: 1,
							compiledCode: "compiled",
							name: bootstrap.scriptSlug,
							slug: bootstrap.scriptSlug,
							createdAt: new Date(0),
							updatedAt: new Date(0),
							contentHash: `${bootstrap.scriptSlug}-hash`,
							id: SandboxScriptId.make(`${bootstrap.scriptSlug}-id`),
							metadata: {
								kind: "script",
								capabilities: [],
								slug: bootstrap.scriptSlug,
								name: bootstrap.scriptSlug,
								requiredPluginConfigKeys: [],
								requiredSystemConfigKeys: [],
							},
						} satisfies ActiveScript,
					})
				: Effect.succeed(null);
		},
	}),
);

it.effect(
	"dispatches sorted trusted entries with bound user authority and deterministic ids",
	() => {
		const payloads: SandboxExecutionPayload[] = [];
		return Effect.gen(function* () {
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					payloads.push(payload);
					return { error: null };
				}),
			);
			yield* dispatcher.dispatchAll(UserId.make("user-1"));

			expect(payloads).toEqual([
				{
					context: {},
					scriptId: "bootstrap.first-id",
					authority: { type: "user", userId: "user-1" },
					executionId: userBootstrapExecutionId("user-1", "media", "first"),
				},
				{
					context: {},
					scriptId: "bootstrap.second-id",
					authority: { type: "user", userId: "user-1" },
					executionId: userBootstrapExecutionId("user-1", "media", "second"),
				},
			]);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("propagates a sandbox result error and reruns the same deterministic identity", () => {
	const executionIds: string[] = [];
	let attempts = 0;
	return Effect.gen(function* () {
		const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) => {
			executionIds.push(payload.executionId);
			attempts += 1;
			return Effect.succeed({
				error: attempts === 1 ? { message: "script failed" } : null,
			});
		});
		const first = yield* Effect.exit(dispatcher.dispatchAll(UserId.make("user-1")));
		expect(first._tag).toBe("Failure");

		yield* dispatcher.dispatchAll(UserId.make("user-1"));
		expect(executionIds[0]).toBe(executionIds[1]);
	}).pipe(Effect.provide(layer));
});
