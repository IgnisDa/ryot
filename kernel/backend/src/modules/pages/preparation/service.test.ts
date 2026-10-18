import { expect, layer } from "@effect/vitest";
import {
	ClientPageDocumentStale,
	ClientPagePreparationError,
	PreparedClientPage,
} from "@ryot-app/contract/modules/pages/schemas";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, PluginId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { ClientArtifactGrantService } from "#modules/pages/bundles/grant-service";
import { ImageClientArtifacts } from "#modules/pages/bundles/image-artifacts";
import { ClientArtifactStore } from "#modules/pages/bundles/store";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";

import { composeClientPage } from "./composition";
import { ClientPageCompositionService } from "./composition-service";
import { resolveClientPageGraph, type ResolvedClientPageGraph } from "./graph";
import { PagesRepository } from "./repository";
import { PagesService } from "./service";

const createdAt = new Date(0);
const runtimeHash = "a".repeat(64);
const pluginHash = "b".repeat(64);
const artifacts = new Map([
	[pluginHash, { files: [{ name: "module.js", contentType: "text/javascript" }] }],
	[runtimeHash, { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
]);
const manifest = fixtureManifest();
const routeTarget = {
	path: "/",
	search: "",
	kind: "plugin-route" as const,
	packageId: manifest.metadata.packageId,
};
const plugin = {
	id: "plugin-id",
	isHidden: false,
	clientImports: [],
	healthReason: null,
	compiledHashes: {},
	scope: "user" as const,
	health: "ready" as const,
	contentHash: "source-hash",
	pluginRevisionId: "revision",
	pluginConfigRevisionId: null,
	installationId: "installation",
	clientArtifactHash: pluginHash,
	ownerUserId: UserId.make("user-1"),
	packageId: manifest.metadata.packageId,
	manifest: {
		...manifest,
		client: {
			homeView: null,
			apiVersion: 1 as const,
			routes: { "/": "main" },
			exports: {
				main: {
					kind: "page" as const,
					entry: "client/main.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
				alternate: {
					kind: "page" as const,
					entry: "client/alternate.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		},
	},
};

const savedView = (id: SavedViewId, revision: number, exportName = "main") => ({
	viewId: id,
	view: {
		id,
		slug: id,
		revision,
		sortOrder: 0,
		settings: {},
		pluginId: null,
		packageId: null,
		createdAt: null,
		updatedAt: null,
		isHidden: false,
		icon: "fixture",
		isBuiltin: false,
		dataSources: null,
		name: `View ${id}`,
		pluginInstallationId: null,
		userId: UserId.make("user-1"),
		renderer: { exportName, pluginId: plugin.id, kind: "plugin" as const },
	},
});

type SavedView = ReturnType<typeof savedView>;
const savedViewReferenceKey = (reference: SavedViewReference) => JSON.stringify(reference);

class AvailablePlugins extends Context.Service<
	AvailablePlugins,
	{ readonly revoke: Effect.Effect<void> }
>()("test/AvailablePlugins") {}

class RecordedPrepareCalls extends Context.Service<
	RecordedPrepareCalls,
	{ readonly calls: Effect.Effect<ReadonlyArray<string>> }
>()("test/RecordedPrepareCalls") {}

class PageSelections extends Context.Service<
	PageSelections,
	{
		readonly setHome: (reference: null | SavedViewReference) => Effect.Effect<void>;
		readonly setView: (reference: SavedViewReference, view: SavedView) => Effect.Effect<void>;
	}
>()("test/PageSelections") {}

const stored = (graph: ResolvedClientPageGraph) => ({
	createdAt,
	identity: graph.identity,
	compositionHash: "composition-hash",
	compositionKey: graph.compositionKey,
	manifest: composeClientPage({
		artifacts,
		identity: graph.identity,
		runtimeEntries: { bootstrap: "bootstrap.js" },
	}),
});

const recordingDependenciesLayer = Layer.effectContext(
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<string>>([]);
		const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
		return Context.make(
			ClientPageCompositionService,
			ClientPageCompositionService.of({
				find: (graph) => Effect.succeed(stored(graph)),
				getOrMaterialize: (graph) =>
					record(`find:${graph.compositionKey}`).pipe(Effect.as(stored(graph))),
			}),
		).pipe(
			Context.add(
				ClientArtifactStore,
				ClientArtifactStore.of({
					isPublic: () => true,
					findFile: () => Effect.succeed(null),
					exists: (hash) => Effect.succeed(artifacts.has(hash)),
					describe: (hash) => {
						const description = artifacts.get(hash);
						return Effect.succeed(
							description
								? {
										...description,
										hash,
										format: 1,
										imports: [],
										apiVersion: 1,
										packageId: null,
										bridgeVersion: 1,
										compilerVersion: 1,
										clientDeclarationHash: null,
									}
								: null,
						);
					},
				}),
			),
			Context.add(
				ClientArtifactGrantService,
				ClientArtifactGrantService.of({
					resolve: () => Effect.die("unused"),
					issue: () => Effect.die("public artifacts must not request grants"),
				}),
			),
			Context.add(RecordedPrepareCalls, { calls: Ref.get(calls) }),
		);
	}),
);

const pagesLayer = PagesService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.mock(DatabaseSession)({}),
			Layer.succeed(
				EntitiesRepository,
				EntitiesRepository.of(
					Object.assign(Object.create(null), {
						getClientPageEntityForUser: () => Effect.succeed(null),
					}),
				),
			),
			Layer.effectContext(
				Effect.gen(function* () {
					const home = yield* Ref.make<null | SavedViewReference>(null);
					const views = yield* Ref.make<ReadonlyMap<string, SavedView>>(new Map());
					return Context.make(
						PagesRepository,
						PagesRepository.of(
							Object.assign(Object.create(null), {
								findHomeSavedView: () => Ref.get(home),
								findPreparedTarget: (_userId: unknown, reference: SavedViewReference) =>
									Ref.get(views).pipe(
										Effect.map((current) => current.get(savedViewReferenceKey(reference)) ?? null),
									),
							}),
						),
					).pipe(
						Context.add(PageSelections, {
							setHome: (reference) => Ref.set(home, reference),
							setView: (reference, view) =>
								Ref.update(views, (current) =>
									new Map(current).set(savedViewReferenceKey(reference), view),
								),
						}),
					);
				}),
			),
			Layer.effectContext(
				Effect.gen(function* () {
					const available = yield* Ref.make<ReadonlyArray<typeof plugin>>([plugin]);
					return Context.make(
						PluginRuntimeResolver,
						PluginRuntimeResolver.of(
							Object.assign(Object.create(null), {
								listPluginsAvailableToUser: () => Ref.get(available),
								resolveUserPackage: (_userId: unknown, packageId: string) =>
									Effect.map(Ref.get(available), (current) => {
										const selected = current.find((entry) => entry.packageId === packageId);
										return selected
											? { kind: "effective" as const, pluginId: PluginId.make(selected.id) }
											: { kind: "absent" as const };
									}),
							}),
						),
					).pipe(Context.add(AvailablePlugins, { revoke: Ref.set(available, []) }));
				}),
			),
			Layer.succeed(
				ImageClientArtifacts,
				ImageClientArtifacts.of(
					Object.assign(Object.create(null), {
						renderers: new Map(),
						runtime: { artifact: { hash: runtimeHash }, entries: { bootstrap: "bootstrap.js" } },
					}),
				),
			),
			recordingDependenciesLayer,
		),
	),
);

layer(pagesLayer)((test) => {
	test.effect("prepares a composition without generating its document", () =>
		Effect.gen(function* () {
			const expected = yield* resolveClientPageGraph({
				plugin,
				plugins: [plugin],
				exportName: "main",
				application: "plugin-route",
				runtimeArtifactHash: runtimeHash,
			});
			const service = yield* PagesService;
			const page = yield* service.prepare({ id: UserId.make("user-1") }, routeTarget);
			expect(page.identity.compositionKey).toBe(expected.compositionKey);
			expect(page.composition.hash).toBe("composition-hash");
			expect(yield* (yield* RecordedPrepareCalls).calls).toEqual([
				`find:${expected.compositionKey}`,
			]);
		}),
	);

	test.effect("generates the document only for an identity that is still current", () =>
		Effect.gen(function* () {
			const service = yield* PagesService;
			const user = { id: UserId.make("user-1") };
			const page = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			const document = yield* service.document(user, page.identity);
			expect(document.metadata.hash).toBe("composition-hash");
			expect(document.bootstrap).toBe(`/api/page-bundles/${runtimeHash}/public/bootstrap.js`);
			const stale = new ClientPageDocumentStale({ reason: { code: "client-page-document-stale" } });
			assertExitFails(
				yield* Effect.exit(
					service.document(user, { ...page.identity, compositionHash: "other-composition" }),
				),
				stale,
			);
			const foreignEntity: PreparedClientPage["identity"] = {
				...page.identity,
				exportName: "main",
				kind: "plugin-page",
				pluginId: plugin.id,
				contentHash: plugin.contentHash,
				installationId: plugin.installationId,
				target: { kind: "entity", entityId: EntityId.make("foreign-entity") },
			};
			assertExitFails(
				yield* Effect.exit(service.document({ id: UserId.make("user-2") }, foreignEntity)),
				stale,
			);
		}),
	);

	test.effect("uses the same changing home selection for preparation and freshness", () =>
		Effect.gen(function* () {
			const user = { id: UserId.make("user-1") };
			const firstReference = { kind: "custom" as const, savedViewId: SavedViewId.make("view-a") };
			const secondReference = { kind: "custom" as const, savedViewId: SavedViewId.make("view-b") };
			const service = yield* PagesService;
			const selections = yield* PageSelections;
			const recorded = yield* RecordedPrepareCalls;
			const stale = new ClientPageDocumentStale({ reason: { code: "client-page-document-stale" } });
			const assertStaleWithoutMaterialization = Effect.fn(function* (
				identity: PreparedClientPage["identity"],
			) {
				const before = yield* recorded.calls;
				expect(yield* service.isIdentityCurrent(user.id, identity)).toBe(false);
				assertExitFails(yield* Effect.exit(service.document(user, identity)), stale);
				expect(yield* recorded.calls).toEqual(before);
			});

			const route = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			expect(route.identity.kind).toBe("plugin-page");
			expect(yield* service.isIdentityCurrent(user.id, route.identity)).toBe(true);

			yield* selections.setView(firstReference, savedView(firstReference.savedViewId, 1));
			yield* selections.setHome(firstReference);
			yield* assertStaleWithoutMaterialization(route.identity);
			const firstHome = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			expect(firstHome.identity).toMatchObject({
				viewRevision: 1,
				exportName: "main",
				target: routeTarget,
				kind: "plugin-saved-view",
				savedViewId: firstReference.savedViewId,
			});
			expect(firstHome.context.target).toEqual({ kind: "saved-view", reference: firstReference });

			yield* selections.setView(firstReference, savedView(firstReference.savedViewId, 2));
			yield* assertStaleWithoutMaterialization(firstHome.identity);
			const revisedHome = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			expect(revisedHome.identity).toMatchObject({ viewRevision: 2, exportName: "main" });

			yield* selections.setView(
				firstReference,
				savedView(firstReference.savedViewId, 2, "alternate"),
			);
			yield* assertStaleWithoutMaterialization(revisedHome.identity);
			const alternateHome = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			expect(alternateHome.identity).toMatchObject({
				viewRevision: 2,
				exportName: "alternate",
				kind: "plugin-saved-view",
			});

			yield* selections.setView(secondReference, savedView(secondReference.savedViewId, 1));
			yield* selections.setHome(secondReference);
			yield* assertStaleWithoutMaterialization(alternateHome.identity);
			const secondHome = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			expect(secondHome.identity).toMatchObject({
				viewRevision: 1,
				kind: "plugin-saved-view",
				savedViewId: secondReference.savedViewId,
			});

			yield* selections.setHome(null);
			yield* assertStaleWithoutMaterialization(secondHome.identity);
			expect(yield* service.isIdentityCurrent(user.id, route.identity)).toBe(true);
		}),
	);

	test.effect("rejects a formerly prepared plugin after catalog revocation", () =>
		Effect.gen(function* () {
			const service = yield* PagesService;
			yield* service.prepare({ id: UserId.make("user-1") }, routeTarget);
			const recorded = yield* RecordedPrepareCalls;
			const before = yield* recorded.calls;
			yield* (yield* AvailablePlugins).revoke;
			const exit = yield* Effect.exit(service.prepare({ id: UserId.make("user-1") }, routeTarget));
			assertExitFails(
				exit,
				new ClientPagePreparationError({
					reason: { packageId: plugin.packageId, code: "plugin-package-unavailable" },
				}),
			);
			expect(yield* recorded.calls).toEqual(before);
		}),
	);
});
