import { expect, layer } from "@effect/vitest";
import {
	ClientPageDocumentStale,
	ClientPagePreparationError,
	PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { EntityId, PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { ClientArtifactGrantService } from "#modules/client-artifacts/grant-service";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStore } from "#modules/client-artifacts/store";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { composeClientPage } from "./composition";
import { ClientPageCompositionService } from "./composition-service";
import { resolveClientPageGraph, type ResolvedClientPageGraph } from "./graph";
import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

const createdAt = new Date(0);
const runtimeHash = "a".repeat(64);
const pluginHash = "b".repeat(64);
const artifacts = new Map([
	[runtimeHash, { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
	[pluginHash, { files: [{ name: "module.js", contentType: "text/javascript" }] }],
]);
const routeTarget = {
	path: "/",
	search: "",
	kind: "plugin-route" as const,
	pluginSlug: PluginSlug.make("fixture"),
};

const manifest = fixtureManifest();
const plugin = {
	id: "plugin-id",
	slug: "fixture",
	isHidden: false,
	compiledHashes: {},
	scope: "user" as const,
	health: "ready" as const,
	sourceHash: "source-hash",
	pluginRevisionId: "revision",
	pluginConfigRevisionId: null,
	installationId: "installation",
	clientArtifactHash: pluginHash,
	ownerUserId: UserId.make("user-1"),
	manifest: {
		...manifest,
		metadata: { ...manifest.metadata, slug: "fixture" },
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
			},
		},
	},
};

class RecordedPrepareCalls extends Context.Service<
	RecordedPrepareCalls,
	{ readonly calls: Effect.Effect<ReadonlyArray<string>> }
>()("test/RecordedPrepareCalls") {}

class AvailablePlugins extends Context.Service<
	AvailablePlugins,
	{ readonly revoke: Effect.Effect<void> }
>()("test/AvailablePlugins") {}

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
										apiVersion: 1,
										bridgeVersion: 1,
										compilerVersion: 1,
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

const pagesLayer = ClientPagesService.layer.pipe(
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
			Layer.succeed(ClientPagesRepository, ClientPagesRepository.of(Object.create(null))),
			Layer.effectContext(
				Effect.gen(function* () {
					const available = yield* Ref.make<ReadonlyArray<typeof plugin>>([plugin]);
					return Context.make(
						PluginRuntimeResolver,
						PluginRuntimeResolver.of(
							Object.assign(Object.create(null), {
								listPluginsAvailableToUser: () => Ref.get(available),
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
			const service = yield* ClientPagesService;
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
			const service = yield* ClientPagesService;
			const user = { id: UserId.make("user-1") };
			const page = yield* Schema.decodeUnknownEffect(PreparedClientPage)(
				yield* service.prepare(user, routeTarget),
			);
			const document = yield* service.document(user, page.identity);
			expect(document.metadata.hash).toBe("composition-hash");
			expect(document.bootstrap).toBe(`/api/client-assets/${runtimeHash}/public/bootstrap.js`);
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
				sourceHash: plugin.sourceHash,
				installationId: plugin.installationId,
				target: { kind: "entity", entityId: EntityId.make("foreign-entity") },
			};
			assertExitFails(
				yield* Effect.exit(service.document({ id: UserId.make("user-2") }, foreignEntity)),
				stale,
			);
		}),
	);

	test.effect("rejects a formerly prepared plugin after catalog revocation", () =>
		Effect.gen(function* () {
			const service = yield* ClientPagesService;
			yield* service.prepare({ id: UserId.make("user-1") }, routeTarget);
			const recorded = yield* RecordedPrepareCalls;
			const before = yield* recorded.calls;
			yield* (yield* AvailablePlugins).revoke;
			const exit = yield* Effect.exit(service.prepare({ id: UserId.make("user-1") }, routeTarget));
			assertExitFails(
				exit,
				new ClientPagePreparationError({
					reason: { code: "plugin-unavailable", pluginId: PluginSlug.make("fixture") },
				}),
			);
			expect(yield* recorded.calls).toEqual(before);
		}),
	);
});
