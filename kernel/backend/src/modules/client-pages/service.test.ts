import { expect, layer } from "@effect/vitest";
import { ClientPagePreparationError } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { composeClientPage } from "./composition";
import { ClientPageCompositionService } from "./composition-service";
import { ClientDocumentGrantService } from "./grant-service";
import { resolveClientPageGraph } from "./graph";
import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

const createdAt = new Date(0);

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
	clientArtifactHash: "plugin-hash",
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

const recordingDependenciesLayer = Layer.effectContext(
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<string>>([]);
		const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
		return Context.make(
			ClientDocumentGrantService,
			ClientDocumentGrantService.of({
				resolve: () => Effect.die("unused"),
				issue: (_userId, hash) =>
					record(`grant:${hash}`).pipe(
						Effect.as({
							grantId: "grant-id",
							expiresAt: "2026-01-01T00:00:00Z",
							src: "/api/client-pages/documents/token",
						}),
					),
			}),
		).pipe(
			Context.add(
				ClientPageCompositionService,
				ClientPageCompositionService.of({
					find: () => Effect.die("unused"),
					getOrMaterialize: (graph) =>
						record(`find:${graph.compositionKey}`).pipe(
							Effect.as({
								createdAt,
								identity: graph.identity,
								compositionHash: "composition-hash",
								compositionKey: graph.compositionKey,
								manifest: composeClientPage({
									identity: graph.identity,
									runtimeEntries: { bootstrap: "bootstrap.js" },
									artifacts: new Map([
										[
											"runtime-hash",
											{ files: [{ name: "bootstrap.js", contentType: "text/javascript" }] },
										],
										[
											"plugin-hash",
											{ files: [{ name: "module.js", contentType: "text/javascript" }] },
										],
									]),
								}),
							}),
						),
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
			Layer.succeed(EntitiesRepository, EntitiesRepository.of(Object.create(null))),
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
						runtime: { artifact: { hash: "runtime-hash" }, entries: { bootstrap: "bootstrap.js" } },
					}),
				),
			),
			recordingDependenciesLayer,
		),
	),
);

layer(pagesLayer)((test) => {
	test.effect("prepares a composition and issues a document grant", () => {
		const target = {
			path: "/",
			search: "",
			kind: "plugin-route" as const,
			pluginSlug: PluginSlug.make("fixture"),
		};
		return Effect.gen(function* () {
			const expected = yield* resolveClientPageGraph({
				plugin,
				plugins: [plugin],
				exportName: "main",
				application: "plugin-route",
				runtimeArtifactHash: "runtime-hash",
			});
			const service = yield* ClientPagesService;
			const page = yield* service.prepare({ id: UserId.make("user-1") }, target);
			expect(page.identity.compositionKey).toBe(expected.compositionKey);
			expect(page.composition.hash).toBe("composition-hash");
			expect(page.composition.documentGrant.src).toBe("/api/client-pages/documents/token");
			expect(yield* (yield* RecordedPrepareCalls).calls).toEqual([
				`find:${expected.compositionKey}`,
				"grant:composition-hash",
			]);
		});
	});

	test.effect("rejects a formerly prepared plugin after catalog revocation", () =>
		Effect.gen(function* () {
			const service = yield* ClientPagesService;
			const target = {
				path: "/",
				search: "",
				kind: "plugin-route" as const,
				pluginSlug: PluginSlug.make("fixture"),
			};
			yield* service.prepare({ id: UserId.make("user-1") }, target);
			const recorded = yield* RecordedPrepareCalls;
			const before = yield* recorded.calls;
			yield* (yield* AvailablePlugins).revoke;
			const exit = yield* Effect.exit(service.prepare({ id: UserId.make("user-1") }, target));
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
