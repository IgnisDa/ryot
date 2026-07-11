import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { databaseLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import {
	PluginInstallationRepository,
	type PluginInstallationState,
} from "#modules/plugins/installation-repository";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import type { PluginRegistryEntry } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { makePluginUserBootstrapDispatcher, userBootstrapExecutionId } from "./plugin-dispatch";

const normalizedPlugin = (
	pluginSlug: string,
	entries: PluginManifest["userBootstrap"],
): PluginRegistryEntry => {
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
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
	};
	return {
		manifest,
		ownerId: null,
		slug: pluginSlug,
		id: `${pluginSlug}-id`,
		scope: "system" as const,
		clientArtifactHash: null,
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
	normalizedPlugin("example", [
		{ slug: "second", scriptSlug: "bootstrap.second", description: "Second" },
		{ slug: "first", scriptSlug: "bootstrap.first", description: "First" },
	]),
);
loader.load(
	normalizedPlugin("sample", [{ slug: "only", scriptSlug: "bootstrap.only", description: "Only" }]),
);

const systemInstallation = (pluginSlug: string): PluginInstallationState => ({
	config: {},
	pluginSlug,
	sortOrder: 0,
	health: "ready",
	isDisabled: false,
	healthReason: null,
	homeSavedViewId: null,
	pluginScope: "system",
	pluginId: `${pluginSlug}-id`,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	id: `${pluginSlug}-installation`,
	userId: UserId.make("user-1"),
});

type ActiveScript = NonNullable<
	Effect.Success<ReturnType<PluginRuntimeResolver["Service"]["findActiveScript"]>>
>;

const baseLayer = Layer.mergeAll(
	databaseLayer,
	Layer.succeed(PluginLoader, {
		...loader,
	}),
	Layer.mock(PluginRuntimeResolver)({
		resolveActivePluginUserBootstrap: ({ bootstrapSlug, pluginSlug }) => {
			const bootstrap = loader
				.getSnapshot()
				.plugins[pluginSlug]?.manifest.userBootstrap.find(({ slug }) => slug === bootstrapSlug);
			return bootstrap
				? Effect.succeed({
						bootstrap,
						script: {
							source: "source",
							providerId: null,
							compiledFormat: 1,
							pluginId: pluginSlug,
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

const layerFor = (installed: Array<PluginInstallationState>) =>
	Layer.mergeAll(
		Layer.mock(PluginInstallationRepository)({
			listSystemForUser: () => Effect.succeed(installed),
		}),
		baseLayer,
	);

it.effect(
	"dispatches sorted installed entries with bound user subject and deterministic ids",
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
					subject: { type: "user", userId: "user-1" },
					executionId: userBootstrapExecutionId("user-1", "example", "first"),
				},
				{
					context: {},
					scriptId: "bootstrap.second-id",
					subject: { type: "user", userId: "user-1" },
					executionId: userBootstrapExecutionId("user-1", "example", "second"),
				},
				{
					context: {},
					scriptId: "bootstrap.only-id",
					subject: { type: "user", userId: "user-1" },
					executionId: userBootstrapExecutionId("user-1", "sample", "only"),
				},
			]);
		}).pipe(
			Effect.provide(layerFor([systemInstallation("example"), systemInstallation("sample")])),
		);
	},
);

it.effect("dispatches nothing for a user with no system installations", () => {
	const payloads: SandboxExecutionPayload[] = [];
	return Effect.gen(function* () {
		const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
			Effect.sync(() => {
				payloads.push(payload);
				return { error: null };
			}),
		);
		yield* dispatcher.dispatchAll(UserId.make("user-1"));

		expect(payloads).toEqual([]);
	}).pipe(Effect.provide(layerFor([])));
});

it.effect("skips snapshot plugins the user has no installation for", () => {
	const executed: string[] = [];
	return Effect.gen(function* () {
		const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
			Effect.sync(() => {
				executed.push(payload.scriptId);
				return { error: null };
			}),
		);
		yield* dispatcher.dispatchAll(UserId.make("user-1"));

		expect(executed).toEqual(["bootstrap.only-id"]);
	}).pipe(Effect.provide(layerFor([systemInstallation("sample")])));
});

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
	}).pipe(Effect.provide(layerFor([systemInstallation("example")])));
});
