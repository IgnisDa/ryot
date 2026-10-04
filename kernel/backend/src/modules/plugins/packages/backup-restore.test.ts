import { assert, expect, layer } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	clientArtifactMetadata,
	clientDeclarationHash,
} from "@ryot-app/client-plugin-contract";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { describe } from "vitest";

import { ArchivePrivatePlugin } from "#modules/backups/archive/schemas";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { DefinitionSnapshot } from "#modules/definitions/snapshot";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { databaseLayer } from "#testing/effect";

import { fixtureClientArtifact } from "../source.test-support";
import { fixtureManifest } from "../test-support";
import { PluginBackupRestore } from "./backup-restore";
import { pluginContentHash } from "./pipeline";
import { PluginRepository } from "./repository";
import { revisionDatabaseLayer } from "./revision.test-support";

const privateManifest = () => ({
	...fixtureManifest(),
	crons: [],
	hooks: [],
	scripts: [],
	workflows: [],
	providers: [],
	operations: [],
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	userBootstrap: [],
	relationshipSchemas: [],
});

const snapshot = {
	definitions: { savedViews: {}, entitySchemas: {}, signalSchemas: {}, relationshipSchemas: {} },
};

class FakeBackupRepository extends Context.Service<
	FakeBackupRepository,
	{ readonly persists: Effect.Effect<number> }
>()("test/FakeBackupRepository") {}

const makeLayer = (input?: { readonly definitions?: DefinitionSnapshot }) => {
	const fakesLayer = Layer.effectContext(
		Effect.gen(function* () {
			const persists = yield* Ref.make(0);
			return Context.make(
				PluginRepository,
				Object.assign(Object.create(null), {
					lockIngestion: () => Effect.void,
					listPortablePluginMetadata: () => Effect.succeed([]),
					persist: () => Ref.update(persists, (count) => count + 1).pipe(Effect.as("plugin-id")),
				}),
			).pipe(Context.add(FakeBackupRepository, { persists: Ref.get(persists) }));
		}),
	);
	return PluginBackupRestore.layer.pipe(
		Layer.provide(
			Layer.mock(DefinitionRepository)({
				getGlobalSnapshot: Effect.succeed(input?.definitions ?? snapshot.definitions),
			}),
		),
		Layer.provideMerge(fakesLayer),
		Layer.provideMerge(databaseLayer),
	);
};

layer(makeLayer())((test) => {
	test.effect("prepares a source-free private package with binary compiled client assets", () => {
		const base = privateManifest();
		const manifest = {
			...base,
			client: {
				homeView: null,
				apiVersion: CLIENT_API_VERSION,
				exports: {
					card: {
						entry: "client/card.tsx",
						kind: "component" as const,
						automaticEntityPresentations: false,
					},
				},
			},
		};
		const files = [
			...fixtureClientArtifact(manifest.metadata.name, manifest.metadata.packageId, manifest.client)
				.files,
			{
				name: "asset.png",
				contentType: "image/png",
				contents: new Uint8Array([0x00, 0xff, 0x80, 0x41]),
			},
		];
		const compiledClient = {
			...clientArtifactMetadata(manifest.metadata.name, manifest.metadata.packageId, files, {
				imports: [],
				clientDeclarationHash: clientDeclarationHash(manifest.client),
			}),
			files,
		};
		const contentHash = pluginContentHash(manifest, [], compiledClient);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const archived = yield* Schema.encodeEffect(ArchivePrivatePlugin)({
				manifest,
				contentHash,
				compiledClient,
				compiledScripts: [],
				version: manifest.metadata.version,
				packageId: manifest.metadata.packageId,
				key: pluginPackageKey({ scope: "user", packageId: manifest.metadata.packageId }),
			});
			expect(archived).not.toHaveProperty("files");
			expect(archived.compiledClient?.files.at(-1)?.contents).toBe("AP+AQQ==");
			const decoded = yield* Schema.decodeEffect(ArchivePrivatePlugin)(archived);
			const prepared = yield* service.prepare([decoded]);

			expect(prepared[0]?.normalized.compiledClient).toEqual(compiledClient);
			expect(prepared[0]?.normalized.contentHash).toBe(contentHash);
			expect(prepared[0]?.normalized).not.toHaveProperty("files");
			const error = yield* service
				.prepare([
					{
						...decoded,
						compiledClient: {
							...compiledClient,
							files: files.map((file) =>
								file.name === "asset.png"
									? {
											name: file.name,
											contentType: file.contentType,
											contents: new Uint8Array([0x01, 0xff, 0x80, 0x41]),
										}
									: file,
							),
						},
					},
				])
				.pipe(Effect.flip);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("rejects a private backup package whose source hash is not exact", () => {
		const manifest = privateManifest();
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const error = yield* service
				.prepare([
					{
						manifest,
						compiledScripts: [],
						contentHash: "a".repeat(64),
						version: manifest.metadata.version,
						packageId: manifest.metadata.packageId,
						key: pluginPackageKey({ scope: "user", packageId: manifest.metadata.packageId }),
					},
				])
				.pipe(Effect.flip);
			expect(error.message).toContain("source hash");
		});
	});
});

layer(
	makeLayer({
		definitions: {
			...snapshot.definitions,
			entitySchemas: {
				collision: {
					icon: "box",
					eventSchemas: {},
					name: "Collision",
					slug: "collision",
					pluginId: "system-id",
					mergeIdentityProperties: [],
					propertiesSchema: { fields: {} },
				},
			},
		},
	}),
)((test) => {
	test.effect("permits an equal local definition name owned by another plugin", () => {
		const manifest = {
			...privateManifest(),
			entitySchemas: [
				{
					icon: "box",
					eventSchemas: [],
					name: "Collision",
					slug: "collision",
					propertiesSchema: { fields: {} },
				},
			],
		};
		const contentHash = pluginContentHash(manifest);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const prepared = yield* service.prepare([
				{
					manifest,
					contentHash,
					compiledScripts: [],
					version: manifest.metadata.version,
					packageId: manifest.metadata.packageId,
					key: pluginPackageKey({ scope: "user", packageId: manifest.metadata.packageId }),
				},
			]);
			expect(prepared).toHaveLength(1);
			expect(yield* (yield* FakeBackupRepository).persists).toBe(0);
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("restores precompiled scripts without compiling before persistence", () => {
		const entry = "backend/automations/broken.sandbox.ts";
		const manifest = {
			...privateManifest(),
			scripts: [
				{
					entry,
					runtimeImports: [],
					name: "Broken script",
					slug: "fixture.broken",
					kind: "script" as const,
					capabilities: [] as const,
					oauthConnectionFields: [],
					executableDependencies: [],
					optionalPluginConfigKeys: [],
					requiredPluginConfigKeys: [] as const,
				},
			],
		};
		const compiledScripts = [{ entry, format: 1, javascript: "export {};" }];
		const contentHash = pluginContentHash(manifest, compiledScripts);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const prepared = yield* service.prepare([
				{
					manifest,
					contentHash,
					compiledScripts,
					version: manifest.metadata.version,
					packageId: manifest.metadata.packageId,
					key: pluginPackageKey({ scope: "user", packageId: manifest.metadata.packageId }),
				},
			]);
			expect(prepared[0]?.normalized.scripts[0]?.compiledCode).toBe("export {};");
			expect(prepared[0]?.normalized.scripts[0]).not.toHaveProperty("source");
			const archived = prepared[0];
			assert(archived);
			const tampered = yield* service
				.prepare([
					{ ...archived, compiledScripts: [{ entry, format: 1, javascript: "export default 1;" }] },
				])
				.pipe(Effect.flip);
			expect(tampered.message).toContain("source hash");
			const missing = yield* service
				.prepare([{ ...archived, compiledScripts: [] }])
				.pipe(Effect.flip);
			expect(missing).toMatchObject({ _tag: "BadRequest" });
			expect(yield* (yield* FakeBackupRepository).persists).toBe(0);
		});
	});
});

layer(makeLayer())((test) => {
	test.effect("rejects duplicate scoped package identities before persistence", () => {
		const manifest = privateManifest();
		const contentHash = pluginContentHash(manifest);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const prepared = yield* service.prepare([
				{
					manifest,
					contentHash,
					compiledScripts: [],
					version: manifest.metadata.version,
					packageId: manifest.metadata.packageId,
					key: pluginPackageKey({ scope: "user", packageId: manifest.metadata.packageId }),
				},
			]);
			const error = yield* service.prepare([...prepared, ...prepared]).pipe(Effect.flip);
			expect(error.message).toContain("duplicate private plugin identity");
			expect(yield* (yield* FakeBackupRepository).persists).toBe(0);
		});
	});
});

const packageAt = (version: string) => {
	const base = privateManifest();
	const manifest = { ...base, metadata: { ...base.metadata, version } };
	return { manifest, scripts: [], contentHash: pluginContentHash(manifest) };
};

describe("private package backup restore in PostgreSQL", () => {
	layer(PluginBackupRestore.layer.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect("restores only the current package as a fresh destination revision", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const plugins = yield* PluginRepository;
				const sourceV1 = packageAt("1.0.0");
				const sourceV2 = packageAt("2.0.0");
				const sourcePluginId = yield* session.transaction(
					plugins.persist(sourceV1, { scope: "user", ownerId: "owner" }),
				);
				yield* session.transaction(plugins.persist(sourceV2, { scope: "user", ownerId: "owner" }));
				const [current] = yield* plugins.listPrivateForUser("owner");
				expect(current?.contentHash).toBe(sourceV2.contentHash);
				const service = yield* PluginBackupRestore;
				const key = pluginPackageKey({
					scope: "user",
					packageId: sourceV2.manifest.metadata.packageId,
				});
				const prepared = yield* service.prepare([
					{
						key,
						compiledScripts: [],
						manifest: sourceV2.manifest,
						contentHash: sourceV2.contentHash,
						version: sourceV2.manifest.metadata.version,
						packageId: sourceV2.manifest.metadata.packageId,
					},
				]);
				const destinationPluginId = (yield* session.transaction(
					service.persist(UserId.make("recipient"), prepared),
				)).get(key);
				expect(destinationPluginId).toBeDefined();
				expect(destinationPluginId).not.toBe(sourcePluginId);
				const [sourceRevisions, destinationRevisions] = yield* session.run((db) =>
					Effect.all([
						db
							.select()
							.from(tables.pluginRevision)
							.where(eq(tables.pluginRevision.pluginId, sourcePluginId)),
						db
							.select()
							.from(tables.pluginRevision)
							.innerJoin(tables.plugin, eq(tables.plugin.id, tables.pluginRevision.pluginId))
							.where(
								and(
									eq(tables.plugin.ownerId, "recipient"),
									eq(tables.pluginRevision.pluginId, destinationPluginId ?? ""),
								),
							),
					]),
				);
				expect(sourceRevisions).toHaveLength(2);
				expect(destinationRevisions).toHaveLength(1);
				expect(destinationRevisions[0]?.plugin_revision.contentHash).toBe(sourceV2.contentHash);
				expect(destinationRevisions[0]?.plugin_revision.id).not.toBe(
					sourceRevisions.find(({ contentHash }) => contentHash === sourceV2.contentHash)?.id,
				);
			}),
		);
	});
});
