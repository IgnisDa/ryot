import { expect, layer } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/scripts/schemas";
import { PluginPackageId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { fixtureManifest } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
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

const systemInstallation = (pluginName: string) => {
	const plugin = plugins.find(({ name }) => name === pluginName);
	assert(plugin);
	return {
		health: "ready",
		isHidden: false,
		pluginId: plugin.id,
		activationId: `${plugin.id}-activation`,
		installationId: `${pluginName}-installation`,
		entries: plugin.manifest.userBootstrap.map(({ slug, scriptSlug }) => ({
			slug,
			scriptId: SandboxScriptId.make(`${scriptSlug}-id`),
		})),
	} satisfies Effect.Success<
		ReturnType<PluginRuntimeResolver["Service"]["resolveUserInstallationBootstraps"]>
	>[number];
};

const layerFor = (installed: Array<ReturnType<typeof systemInstallation>>) =>
	Layer.mergeAll(
		databaseLayer,
		Layer.mock(PluginInstallationRepository)({
			completeSystemInitialization: () => Effect.succeed(true),
			completeNoEntryInitializations: () => Effect.succeed([]),
		}),
		Layer.mock(PluginRuntimeResolver)({
			resolveUserInstallationBootstraps: () => Effect.succeed(installed),
			resolveInstallationBootstrap: () =>
				Effect.die("dispatchAll must not resolve installations one at a time"),
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
				Parameters<PluginInstallationRepository["Service"]["completeNoEntryInitializations"]>[0]
			> = [];
			const repository = yield* PluginInstallationRepository;
			const dispatcher = yield* makePluginUserBootstrapDispatcher(() =>
				Effect.die("No bootstrap script should run"),
			).pipe(
				Effect.provideService(PluginInstallationRepository, {
					...repository,
					completeNoEntryInitializations: (input) =>
						Effect.sync(() => {
							marks.push(input);
							return [];
						}),
				}),
			);
			const userId = UserId.make("user-1");
			yield* dispatcher.dispatchAll(userId, { userId, token: "test-account-generation" });
			expect(marks).toEqual([
				{
					userId,
					installations: [
						{ activationId: "idle-id-activation", installationId: "idle-installation" },
					],
				},
			]);
		}),
	);
});

layer(layerFor([systemInstallation("idle"), systemInstallation("sample")]))((test) => {
	test.effect("completes no-entry installations before running any bootstrap script", () =>
		Effect.gen(function* () {
			const steps: Array<string> = [];
			const repository = yield* PluginInstallationRepository;
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					steps.push(`execute ${payload.scriptId}`);
					return { error: null };
				}),
			).pipe(
				Effect.provideService(PluginInstallationRepository, {
					...repository,
					completeSystemInitialization: ({ installationId }) =>
						Effect.sync(() => {
							steps.push(`complete ${installationId}`);
							return true;
						}),
					completeNoEntryInitializations: ({ installations }) =>
						Effect.sync(() => {
							steps.push(
								`no-entry ${installations.map(({ installationId }) => installationId).join(",")}`,
							);
							return [];
						}),
				}),
			);
			const userId = UserId.make("user-1");
			yield* dispatcher.dispatchAll(userId, { userId, token: "test-account-generation" });
			expect(steps).toEqual([
				"no-entry idle-installation",
				"execute bootstrap.only-id",
				"complete sample-installation",
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
						resolveUserInstallationBootstraps: (userId) =>
							runtime
								.resolveUserInstallationBootstraps(userId)
								.pipe(
									Effect.map((installed) =>
										installed.map((captured) => ({
											...captured,
											entries: captured.entries.map((entry) => ({
												...entry,
												scriptId: SandboxScriptId.make(`${entry.slug}-old`),
											})),
										})),
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

const bootstrappedPackage = (slug: string, bootstrapSlugs: Array<string>) => {
	const value = revisionPackage(slug, "v1", undefined, PluginPackageId.make(`test/${slug}`));
	return {
		...value,
		manifest: {
			...value.manifest,
			userBootstrap: bootstrapSlugs.map((bootstrapSlug) => ({
				slug: bootstrapSlug,
				description: bootstrapSlug,
				scriptSlug: `${slug}.task`,
			})),
		},
	};
};

layer(revisionDatabaseLayer)((test) => {
	test.effect("initializes a user's installations with and without bootstrap entries", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* PluginRepository;
			const installations = yield* PluginInstallationRepository;
			const userId = UserId.make("owner");
			const accountGeneration = { userId, token: "test-account-generation" };
			const [alpha, beta, idle] = yield* session.transaction(
				Effect.gen(function* () {
					yield* repository.lockIngestion();
					const pluginIds = yield* Effect.forEach(
						[
							bootstrappedPackage("alpha", ["seed"]),
							bootstrappedPackage("beta", ["first", "second"]),
							bootstrappedPackage("idle", []),
						],
						(plugin) => repository.persist(plugin, { ownerId: null, scope: "system" }),
					);
					yield* installations.provisionSystemInstallationsForUser(userId);
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ health: "installing", isInitialized: false })
							.where(eq(tables.pluginInstallation.userId, userId)),
					);
					return pluginIds;
				}),
			);
			assert(alpha && beta && idle);
			const executionIds: Array<string> = [];
			const dispatcher = yield* makePluginUserBootstrapDispatcher((payload) =>
				Effect.sync(() => {
					executionIds.push(payload.executionId);
					return { error: null };
				}),
			);
			yield* dispatcher.dispatchAll(userId, accountGeneration);
			expect(executionIds).toEqual([
				userBootstrapExecutionId(userId, alpha, "seed", accountGeneration),
				userBootstrapExecutionId(userId, beta, "first", accountGeneration),
				userBootstrapExecutionId(userId, beta, "second", accountGeneration),
			]);
			const rows = yield* session.run((db) =>
				db
					.select({
						health: tables.pluginInstallation.health,
						pluginId: tables.pluginInstallation.pluginId,
						healthReason: tables.pluginInstallation.healthReason,
						isInitialized: tables.pluginInstallation.isInitialized,
					})
					.from(tables.pluginInstallation)
					.where(eq(tables.pluginInstallation.userId, userId)),
			);
			const initialized = { health: "ready", healthReason: null, isInitialized: true };
			expect(Object.fromEntries(rows.map(({ pluginId, ...state }) => [pluginId, state]))).toEqual({
				[beta]: initialized,
				[idle]: initialized,
				[alpha]: initialized,
			});
		}),
	);
});
