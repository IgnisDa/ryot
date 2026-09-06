import { expect, it } from "@effect/vitest";
import { PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
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

it.effect(
	"prepares a materialized composition without building or re-checking document assets",
	() => {
		const manifest = fixtureManifest();
		const plugin = {
			id: "plugin-id",
			slug: "fixture",
			isDisabled: false,
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
		const calls: string[] = [];
		const target = {
			path: "/",
			search: "",
			kind: "plugin-route" as const,
			pluginSlug: PluginSlug.make("fixture"),
		};
		const layer = ClientPagesService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(EntitiesRepository, EntitiesRepository.of(Object.create(null))),
					Layer.succeed(ClientPagesRepository, ClientPagesRepository.of(Object.create(null))),
					Layer.succeed(
						PluginRuntimeResolver,
						PluginRuntimeResolver.of(
							Object.assign(Object.create(null), {
								listPluginsAvailableToUser: () => Effect.succeed([plugin]),
							}),
						),
					),
					Layer.succeed(
						ImageClientArtifacts,
						ImageClientArtifacts.of(
							Object.assign(Object.create(null), {
								renderers: new Map(),
								runtime: {
									artifact: { hash: "runtime-hash" },
									entries: { bootstrap: "bootstrap.js" },
								},
							}),
						),
					),
					Layer.succeed(
						ClientDocumentGrantService,
						ClientDocumentGrantService.of({
							resolve: () => Effect.die("unused"),
							issue: (_userId, hash) =>
								Effect.sync(() => {
									calls.push(`grant:${hash}`);
									return {
										grantId: "grant-id",
										expiresAt: "2026-01-01T00:00:00Z",
										src: "/api/client-pages/documents/token",
									};
								}),
						}),
					),
					Layer.succeed(
						ClientPageCompositionService,
						ClientPageCompositionService.of({
							materialize: () => Effect.die("prepare must not materialize"),
							find: (graph) =>
								Effect.sync(() => {
									calls.push(`find:${graph.compositionKey}`);
									return {
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
									};
								}),
						}),
					),
					Layer.succeed(Database, Database.of(Object.create(null))),
				),
			),
		);
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
			expect(calls).toEqual([`find:${expected.compositionKey}`, "grant:composition-hash"]);
		}).pipe(
			Effect.provide(layer),
			Effect.provideService(Database, Database.of(Object.create(null))),
		);
	},
);
