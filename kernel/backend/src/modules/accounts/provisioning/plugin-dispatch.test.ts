import { expect, layer } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import { PluginPackageId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	PluginInstallationRepository,
	type PluginInstallationState,
} from "#modules/plugins/installations/repository";
import { fixtureManifest } from "#modules/plugins/test-support";
import { databaseLayer } from "#testing/effect";

import { makePluginUserBootstrapDispatcher, userBootstrapExecutionId } from "./plugin-dispatch";

const normalizedPlugin = (pluginName: string, entries: PluginManifest["userBootstrap"]) => {
	const base = fixtureManifest(PluginPackageId.make(`test/${pluginName}`));
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
		hooks: [],
		savedViews: [],
		entitySchemas: [],
		signalSchemas: [],
		userBootstrap: entries,
		relationshipSchemas: [],
		metadata: { ...base.metadata },
	};
	return {
		manifest,
		ownerId: null,
		name: pluginName,
		id: `${pluginName}-id`,
		scope: "system" as const,
		packageId: base.metadata.packageId,
		contentHash: `${pluginName}-source`,
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

const plugins = [
	normalizedPlugin("idle", []),
	normalizedPlugin("example", [
		{ slug: "second", description: "Second", scriptSlug: "bootstrap.second" },
		{ slug: "first", description: "First", scriptSlug: "bootstrap.first" },
	]),
	normalizedPlugin("sample", [{ slug: "only", description: "Only", scriptSlug: "bootstrap.only" }]),
];

const systemInstallation = (pluginName: string): PluginInstallationState => {
	const plugin = plugins.find(({ name }) => name === pluginName);
	assert(plugin);
	return {
		sortOrder: 0,
		health: "ready",
		isHidden: false,
		userSettings: {},
		healthReason: null,
		uninstalledAt: null,
		homeSavedView: null,
		isInitialized: false,
		pluginScope: "system",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		incompatibilityReason: null,
		activeConfigRevisionId: null,
		pluginId: `${pluginName}-id`,
		userId: UserId.make("user-1"),
		id: `${pluginName}-installation`,
		packageId: plugin.manifest.metadata.packageId,
	};
};

const baseLayer = Layer.mergeAll(
	databaseLayer,
	Layer.mock(PluginRuntimeResolver)({
		listSystemUserBootstraps: () =>
			Effect.succeed(
				plugins
					.flatMap((plugin) =>
						plugin.manifest.userBootstrap.map((bootstrap) => ({
							bootstrap,
							pluginId: plugin.id,
							packageId: plugin.packageId,
						})),
					)
					.sort(
						(left, right) =>
							left.packageId.localeCompare(right.packageId) ||
							left.bootstrap.slug.localeCompare(right.bootstrap.slug),
					),
			),
		resolveInstallationBootstrap: (installationId) => {
			const plugin = plugins.find(({ name }) => `${name}-installation` === installationId);
			return Effect.succeed(
				plugin
					? {
							health: "ready",
							pluginScope: "system",
							userId: UserId.make("user-1"),
							activationId: `${plugin.id}-activation`,
							entries: plugin.manifest.userBootstrap.map(({ slug, scriptSlug }) => ({
								slug,
								scriptId: SandboxScriptId.make(`${scriptSlug}-id`),
							})),
						}
					: null,
			);
		},
		resolveActivePluginUserBootstrap: ({ pluginId, bootstrapSlug }) => {
			const bootstrap = plugins
				.find(({ id }) => id === pluginId)
				?.manifest.userBootstrap.find(({ slug }) => slug === bootstrapSlug);
			return bootstrap
				? Effect.succeed({
						bootstrap,
						script: {
							pluginId,
							providerId: null,
							name: bootstrap.scriptSlug,
							slug: bootstrap.scriptSlug,
							contentHash: `${bootstrap.scriptSlug}-hash`,
							pluginRevisionId: `${pluginId}-revision-id`,
							id: SandboxScriptId.make(`${bootstrap.scriptSlug}-id`),
							metadata: {
								kind: "script",
								...emptySandboxExecutionMetadata,
								slug: bootstrap.scriptSlug,
								name: bootstrap.scriptSlug,
							},
						} satisfies NonNullable<
							Effect.Success<
								ReturnType<PluginRuntimeResolver["Service"]["resolveActivePluginUserBootstrap"]>
							>
						>["script"],
					})
				: Effect.succeed(null);
		},
	}),
);

const layerFor = (installed: Array<PluginInstallationState>) =>
	Layer.mergeAll(
		Layer.mock(PluginInstallationRepository)({
			listSystemForUser: () => Effect.succeed(installed),
			completeSystemInitialization: () => Effect.succeed(true),
		}),
		baseLayer,
	);

layer(layerFor([systemInstallation("example"), systemInstallation("sample")]))((test) => {
	test.effect("marks only each plugin's successful captured bootstrap completion", () =>
		Effect.gen(function* () {
			const marks: Array<
				Parameters<PluginInstallationRepository["Service"]["completeSystemInitialization"]>[0]
			> = [];
			const repository = yield* PluginInstallationRepository;
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					if (payload.scriptId === "bootstrap.second-id") {
						expect(marks).toEqual([]);
					}
					return { error: null };
				}),
			).pipe(
				Effect.provideService(PluginInstallationRepository, {
					...repository,
					completeSystemInitialization: (input) =>
						Effect.sync(() => {
							marks.push(input);
							return true;
						}),
				}),
			);
			const userId = UserId.make("user-1");
			yield* dispatcher.dispatchAll(userId, { userId, token: "test-account-generation" });
			expect(marks).toEqual([
				{ userId, activationId: "example-id-activation", installationId: "example-installation" },
				{ userId, activationId: "sample-id-activation", installationId: "sample-installation" },
			]);
		}),
	);
	test.effect(
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
				yield* dispatcher.dispatchAll(UserId.make("user-1"), {
					userId: UserId.make("user-1"),
					token: "test-account-generation",
				});

				expect(payloads).toEqual([
					{
						context: {},
						scriptId: "bootstrap.first-id",
						executionId: userBootstrapExecutionId("user-1", "example-id", "first", {
							userId: UserId.make("user-1"),
							token: "test-account-generation",
						}),
						subject: {
							type: "user",
							userId: "user-1",
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						},
					},
					{
						context: {},
						scriptId: "bootstrap.second-id",
						executionId: userBootstrapExecutionId("user-1", "example-id", "second", {
							userId: UserId.make("user-1"),
							token: "test-account-generation",
						}),
						subject: {
							type: "user",
							userId: "user-1",
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						},
					},
					{
						context: {},
						scriptId: "bootstrap.only-id",
						executionId: userBootstrapExecutionId("user-1", "sample-id", "only", {
							userId: UserId.make("user-1"),
							token: "test-account-generation",
						}),
						subject: {
							type: "user",
							userId: "user-1",
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						},
					},
				]);
			});
		},
	);
});

layer(layerFor([systemInstallation("idle")]))((test) => {
	test.effect("marks an exact no-bootstrap installation without running a script", () =>
		Effect.gen(function* () {
			const marks: Array<
				Parameters<PluginInstallationRepository["Service"]["completeSystemInitialization"]>[0]
			> = [];
			const repository = yield* PluginInstallationRepository;
			const dispatcher = yield* makePluginUserBootstrapDispatcher(() =>
				Effect.die("No bootstrap script should run"),
			).pipe(
				Effect.provideService(PluginInstallationRepository, {
					...repository,
					completeSystemInitialization: (input) =>
						Effect.sync(() => {
							marks.push(input);
							return true;
						}),
				}),
			);
			const userId = UserId.make("user-1");
			yield* dispatcher.dispatchAll(userId, { userId, token: "test-account-generation" });
			expect(marks).toEqual([
				{ userId, activationId: "idle-id-activation", installationId: "idle-installation" },
			]);
		}),
	);
});

layer(layerFor([]))((test) => {
	test.effect("dispatches nothing for a user with no system installations", () => {
		const payloads: SandboxExecutionPayload[] = [];
		return Effect.gen(function* () {
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					payloads.push(payload);
					return { error: null };
				}),
			);
			yield* dispatcher.dispatchAll(UserId.make("user-1"), {
				userId: UserId.make("user-1"),
				token: "test-account-generation",
			});

			expect(payloads).toEqual([]);
		});
	});
});

layer(layerFor([systemInstallation("sample")]))((test) => {
	test.effect("skips snapshot plugins the user has no installation for", () => {
		const executed: string[] = [];
		return Effect.gen(function* () {
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					executed.push(payload.scriptId);
					return { error: null };
				}),
			);
			yield* dispatcher.dispatchAll(UserId.make("user-1"), {
				userId: UserId.make("user-1"),
				token: "test-account-generation",
			});

			expect(executed).toEqual(["bootstrap.only-id"]);
		});
	});

	test.effect("reruns bootstrap scripts after a reset with a new durable identity", () => {
		const executionIds: string[] = [];
		return Effect.gen(function* () {
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					executionIds.push(payload.executionId);
					return { error: null };
				}),
			);
			const userId = UserId.make("user-1");
			const accountGeneration = { userId, token: "test-account-generation" };
			yield* dispatcher.dispatchAll(userId, accountGeneration);
			yield* dispatcher.dispatchAll(userId, accountGeneration, "reset-operation-1");
			yield* dispatcher.dispatchAll(userId, accountGeneration, "reset-operation-1");
			expect(executionIds[1]).not.toBe(executionIds[0]);
			expect(executionIds[2]).toBe(executionIds[1]);
		});
	});
});

layer(layerFor([systemInstallation("example")]))((test) => {
	test.effect(
		"does not mark initialization from bootstrap results selected from another revision",
		() =>
			Effect.gen(function* () {
				const marks: Array<
					Parameters<PluginInstallationRepository["Service"]["completeSystemInitialization"]>[0]
				> = [];
				const repository = yield* PluginInstallationRepository;
				const runtime = yield* PluginRuntimeResolver;
				const dispatcher = yield* makePluginUserBootstrapDispatcher(() =>
					Effect.succeed({ error: null }),
				).pipe(
					Effect.provideService(PluginInstallationRepository, {
						...repository,
						completeSystemInitialization: (input) =>
							Effect.sync(() => {
								marks.push(input);
								return true;
							}),
					}),
					Effect.provideService(PluginRuntimeResolver, {
						...runtime,
						resolveInstallationBootstrap: (id) =>
							runtime
								.resolveInstallationBootstrap(id)
								.pipe(
									Effect.map(
										(captured) =>
											captured && {
												...captured,
												entries: captured.entries.map((entry) => ({
													...entry,
													scriptId: SandboxScriptId.make(`${entry.slug}-old`),
												})),
											},
									),
								),
					}),
				);
				const userId = UserId.make("user-1");
				yield* dispatcher.dispatchAll(userId, { userId, token: "test-account-generation" });
				expect(marks).toEqual([]);
			}),
	);
	test.effect(
		"propagates a sandbox result error and reruns the same deterministic identity",
		() => {
			const executionIds: string[] = [];
			let attempts = 0;
			return Effect.gen(function* () {
				const marks: Array<
					Parameters<PluginInstallationRepository["Service"]["completeSystemInitialization"]>[0]
				> = [];
				const repository = yield* PluginInstallationRepository;
				const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) => {
					executionIds.push(payload.executionId);
					attempts += 1;
					return Effect.succeed({ error: attempts === 1 ? { message: "script failed" } : null });
				}).pipe(
					Effect.provideService(PluginInstallationRepository, {
						...repository,
						completeSystemInitialization: (input) =>
							Effect.sync(() => {
								marks.push(input);
								return true;
							}),
					}),
				);
				const first = yield* Effect.exit(
					dispatcher.dispatchAll(UserId.make("user-1"), {
						userId: UserId.make("user-1"),
						token: "test-account-generation",
					}),
				);
				expect(first._tag).toBe("Failure");
				expect(marks).toEqual([]);

				yield* dispatcher.dispatchAll(UserId.make("user-1"), {
					userId: UserId.make("user-1"),
					token: "test-account-generation",
				});
				expect(executionIds[0]).toBe(executionIds[1]);
				expect(marks).toEqual([
					{
						userId: UserId.make("user-1"),
						activationId: "example-id-activation",
						installationId: "example-installation",
					},
				]);
			});
		},
	);
});
