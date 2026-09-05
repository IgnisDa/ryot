import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver, type AvailablePlugin } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { ClientPageBuildService } from "./build-service";
import { ClientPageArtifactGrantService } from "./grant-service";
import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

const userId = UserId.make("user-1");
const bytes = (value: string) => new TextEncoder().encode(value);
const artifact = {
	hash: "artifact-1",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	files: [{ name: "index.html", contentType: "text/html", contents: bytes("<html></html>") }],
};

it.effect("materializes one global build for two users and never compiles on prepare", () => {
	let installationId = "installation-1";
	let sourceHash = "source-1";
	let health: AvailablePlugin["health"] = "ready";
	let compilations = 0;
	let sourceLoads = 0;
	let extraOperationTarget = false;
	const builds = new Map<
		string,
		{
			artifactKey: string;
			artifactIdentity: Parameters<
				ClientPagesRepository["Service"]["createBuild"]
			>[0]["artifactIdentity"];
			artifactHash: string;
			format: number;
			apiVersion: number;
			bridgeVersion: number;
			compilerVersion: number;
		}
	>();
	const available = (): AvailablePlugin => {
		const manifest = fixtureManifest();
		return {
			health,
			sourceHash,
			id: "plugin-1",
			installationId,
			scope: "system",
			isDisabled: false,
			ownerUserId: null,
			compiledHashes: {},
			pluginRevisionId: "revision-1",
			slug: PluginSlug.make("fixture"),
			pluginConfigRevisionId: "config-1",
			manifest: {
				...manifest,
				client: {
					apiVersion: 1,
					homeView: null,
					pluginDependencies: [],
					routes: { "/": "page" },
					exports: {
						page: {
							kind: "page",
							entry: "client/page.tsx",
							settingsSchema: { fields: {} },
							automaticEntityPresentations: false,
						},
					},
				},
			},
		};
	};
	const savedView = {
		renderer: null,
		viewId: "view-1",
		rendererId: null,
		view: {
			revision: 1,
			id: "view-1",
			icon: "home",
			settings: {},
			dataSources: null,
			slug: "fixture-home",
			name: "Fixture Home",
			renderer: { exportName: "page", pluginId: "plugin-1", kind: "plugin" as const },
		},
	};
	const repository = Layer.succeed(
		ClientPagesRepository,
		ClientPagesRepository.of(
			Object.assign(Object.create(null), {
				findPreparedTarget: () => Effect.succeed(savedView),
				listPreparedTargets: () => Effect.succeed([savedView]),
				findBuild: (key: string) => Effect.succeed(builds.get(key) ?? null),
				createBuild: (input: Parameters<ClientPagesRepository["Service"]["createBuild"]>[0]) =>
					Effect.sync(() => {
						builds.set(input.artifactKey, {
							...input,
							format: artifact.format,
							apiVersion: artifact.apiVersion,
							bridgeVersion: artifact.bridgeVersion,
							compilerVersion: artifact.compilerVersion,
						});
						return input.artifactKey;
					}),
			}),
		),
	);
	const pluginRepository = Layer.succeed(
		PluginRepository,
		PluginRepository.of(
			Object.assign(Object.create(null), {
				persistClientArtifact: () => Effect.void,
				listRevisionSourceFiles: () =>
					Effect.sync(() => {
						sourceLoads++;
						return { "client/page.tsx": bytes("export default function Page() {}") };
					}),
			}),
		),
	);
	const buildLayer = ClientPageBuildService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				repository,
				pluginRepository,
				Layer.succeed(
					ClientPluginCompiler,
					ClientPluginCompiler.of({
						compile: () =>
							Effect.sync(() => {
								compilations++;
								return artifact;
							}),
					}),
				),
			),
		),
	);
	const dbLayer = Layer.succeed(
		Database,
		Database.of(
			Object.assign(Object.create(null), {
				select: () => ({
					from: (table: unknown) =>
						table === schema.globalSavedView
							? Effect.succeed([{ renderer: savedView.view.renderer }])
							: {
									innerJoin: () => ({
										where: () =>
											Effect.sync(() => {
												const plugin = available();
												return [
													{
														id: plugin.id,
														slug: plugin.slug,
														manifest: plugin.manifest,
														sourceHash: plugin.sourceHash,
														pluginRevisionId: plugin.pluginRevisionId,
													},
												];
											}),
									}),
								},
				}),
			}),
		),
	);
	const pageLayer = ClientPagesService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbLayer,
				repository,
				pluginRepository,
				buildLayer,
				PluginCatalogInvalidator.layer,
				Layer.succeed(
					ClientPageArtifactGrantService,
					ClientPageArtifactGrantService.of(
						Object.assign(Object.create(null), {
							issue: () =>
								Effect.succeed({
									src: "/artifact",
									grantId: "grant-1",
									expiresAt: "2099-01-01T00:00:00.000Z",
								}),
						}),
					),
				),
				Layer.succeed(EntitiesRepository, EntitiesRepository.of(Object.create(null))),
				Layer.succeed(
					PluginRuntimeResolver,
					PluginRuntimeResolver.of(
						Object.assign(Object.create(null), {
							listPluginsAvailableToUser: () =>
								Effect.sync(() => {
									const current = available();
									return extraOperationTarget
										? [
												current,
												{
													...current,
													id: "added",
													slug: PluginSlug.make("added"),
													installationId: "added-installation",
												},
											]
										: [current];
								}),
						}),
					),
				),
			),
		),
	);
	return Effect.gen(function* () {
		const pages = yield* ClientPagesService;
		const target = {
			path: "/",
			search: "",
			kind: "plugin-route" as const,
			pluginSlug: PluginSlug.make("fixture"),
		};
		yield* pages.materializeSystemBaseline();
		const initialCompilations = compilations;
		expect(initialCompilations).toBeGreaterThan(0);
		yield* pages.assertUserBuilds(userId);
		expect(compilations).toBe(initialCompilations);
		const initialSourceLoads = sourceLoads;
		const page1 = yield* pages.prepare({ id: userId }, target);
		const view = yield* pages.prepare({ id: userId }, { kind: "saved-view", slug: "fixture-home" });
		const preparedPage = yield* Schema.decodeUnknownEffect(PreparedClientPage)(page1);
		expect(sourceLoads).toBe(initialSourceLoads);
		expect(yield* pages.isIdentityCurrent(userId, preparedPage.identity)).toBe(true);
		expect(sourceLoads).toBe(initialSourceLoads);
		extraOperationTarget = true;
		expect(yield* pages.isIdentityCurrent(userId, preparedPage.identity)).toBe(false);
		extraOperationTarget = false;
		expect((yield* Schema.decodeUnknownEffect(PreparedClientPage)(view)).identity.kind).toBe(
			"plugin-saved-view",
		);
		expect(view.identity.kind).toBe("plugin-saved-view");
		expect(view.context.renderer).toEqual({
			kind: "plugin",
			exportName: "page",
			pluginId: "plugin-1",
		});
		installationId = "installation-2";
		yield* pages.materializeUser(UserId.make("user-2"));
		const page2 = yield* pages.prepare({ id: UserId.make("user-2") }, target);
		expect(compilations).toBe(initialCompilations);
		expect(page1.identity.artifactKey).toBe(page2.identity.artifactKey);
		expect(page1.identity.contributors).not.toEqual(page2.identity.contributors);
		expect(page1.artifact.hash).toBe(page2.artifact.hash);
		sourceHash = "source-2";
		const exit = yield* Effect.exit(pages.prepare({ id: userId }, target));
		expect(exit._tag).toBe("Failure");
		expect(compilations).toBe(initialCompilations);
		yield* pages.materializeRenderer(userId, {
			kind: "plugin",
			exportName: "page",
			pluginId: "plugin-1",
		});
		const currentView = yield* pages.prepare(
			{ id: userId },
			{ kind: "saved-view", slug: "fixture-home" },
		);
		expect(currentView.identity.artifactKey).not.toBe(view.identity.artifactKey);
		expect(compilations).toBe(initialCompilations + 1);
		sourceHash = "source-3";
		health = "installing";
		yield* pages.materializePendingInstallation(userId, installationId);
		const materializedCompilations = compilations;
		expect(materializedCompilations).toBeGreaterThan(initialCompilations + 1);
		health = "ready";
		const ready = yield* pages.prepare({ id: userId }, target);
		expect(ready.identity.artifactKey).not.toBe(page1.identity.artifactKey);
		expect(compilations).toBe(materializedCompilations);
	}).pipe(Effect.provide(Layer.merge(pageLayer, dbLayer)));
});
