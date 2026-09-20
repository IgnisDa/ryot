import { assert, expect, layer } from "@effect/vitest";
import { CLIENT_API_VERSION, clientArtifactMetadata } from "@ryot-app/client-plugin-contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { databaseLayer } from "#lib/test-utils/effect";
import { ArchivePrivatePlugin } from "#modules/backups/archive/schemas";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { DefinitionSnapshot } from "#modules/definition-registry/snapshot";

import { PluginBackupRestore } from "./backup-restore";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginInstallationRepository } from "./installation-repository";
import { pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { revisionDatabaseLayer } from "./revision.test-support";
import { fixtureClientArtifact } from "./source.test-support";
import { fixtureManifest } from "./test-support";

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
const noRevisionActivation = Layer.succeed(PluginRevisionActivation, {
	activated: () => Effect.void,
});

class FakeBackupRepository extends Context.Service<
	FakeBackupRepository,
	{ readonly persists: Effect.Effect<number> }
>()("test/FakeBackupRepository") {}

const makeLayer = (input?: {
	readonly definitions?: DefinitionSnapshot;
	readonly systemSlugAddedOnLock?: string;
}) => {
	const fakesLayer = Layer.effectContext(
		Effect.gen(function* () {
			const persists = yield* Ref.make(0);
			const lockedSystemSlugs = yield* Ref.make<ReadonlyArray<string>>([]);
			const slug = input?.systemSlugAddedOnLock;
			return Context.make(
				PluginRepository,
				Object.assign(Object.create(null), {
					listPortablePluginMetadata: () => Effect.succeed([]),
					persist: () => Ref.update(persists, (count) => count + 1).pipe(Effect.as("plugin-id")),
					listActiveSystemSlugs: () =>
						Effect.map(Ref.get(lockedSystemSlugs), (slugs) => [...slugs]),
					lockIngestion: () =>
						slug === undefined
							? Effect.void
							: Ref.update(lockedSystemSlugs, (slugs) => [...slugs, slug]),
				}),
			).pipe(Context.add(FakeBackupRepository, { persists: Ref.get(persists) }));
		}),
	);
	const ingestionLockLayer = PluginIngestionLock.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				noRevisionActivation,
				Layer.mock(PluginInstallationRepository)({
					refreshClientConfigsForPlugin: () => Effect.void,
				}),
			),
		),
	);
	return PluginBackupRestore.layer.pipe(
		Layer.provide(
			Layer.merge(
				ingestionLockLayer,
				Layer.mock(DefinitionRepository)({
					getGlobalSnapshot: Effect.succeed(input?.definitions ?? snapshot.definitions),
				}),
			),
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
			...fixtureClientArtifact(manifest.metadata.name).files,
			{
				name: "asset.png",
				contentType: "image/png",
				contents: new Uint8Array([0x00, 0xff, 0x80, 0x41]),
			},
		];
		const compiledClient = { ...clientArtifactMetadata(manifest.metadata.name, files), files };
		const sourceHash = pluginSourceHash(manifest, [], compiledClient);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const archived = yield* Schema.encodeEffect(ArchivePrivatePlugin)({
				manifest,
				sourceHash,
				compiledClient,
				compiledScripts: [],
				slug: manifest.metadata.slug,
				version: manifest.metadata.version,
				key: `user:${manifest.metadata.slug}:${sourceHash}`,
			});
			expect(archived).not.toHaveProperty("files");
			expect(archived.compiledClient?.files.at(-1)?.contents).toBe("AP+AQQ==");
			const decoded = yield* Schema.decodeEffect(ArchivePrivatePlugin)(archived);
			const prepared = yield* service.prepare([decoded]);

			expect(prepared[0]?.normalized.compiledClient).toEqual(compiledClient);
			expect(prepared[0]?.normalized.sourceHash).toBe(sourceHash);
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
						sourceHash: "a".repeat(64),
						slug: manifest.metadata.slug,
						version: manifest.metadata.version,
						key: `user:${manifest.metadata.slug}:${"a".repeat(64)}`,
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
					pluginSlug: "system",
					pluginId: "system-id",
					mergeIdentityProperties: [],
					propertiesSchema: { fields: {} },
				},
			},
		},
	}),
)((test) => {
	test.effect("rejects a definition collision before private plugin persistence", () => {
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
		const sourceHash = pluginSourceHash(manifest);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const error = yield* service
				.prepare([
					{
						manifest,
						sourceHash,
						compiledScripts: [],
						slug: manifest.metadata.slug,
						version: manifest.metadata.version,
						key: `user:${manifest.metadata.slug}:${sourceHash}`,
					},
				])
				.pipe(Effect.flip);
			expect(error.message).toContain("collision");
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
		const sourceHash = pluginSourceHash(manifest, compiledScripts);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const prepared = yield* service.prepare([
				{
					manifest,
					sourceHash,
					compiledScripts,
					slug: manifest.metadata.slug,
					version: manifest.metadata.version,
					key: `user:${manifest.metadata.slug}:${sourceHash}`,
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

layer(makeLayer({ systemSlugAddedOnLock: privateManifest().metadata.slug }))((test) => {
	test.effect("rejects persistence when a system slug appears after backup preparation", () => {
		const manifest = privateManifest();
		const sourceHash = pluginSourceHash(manifest);
		return Effect.gen(function* () {
			const service = yield* PluginBackupRestore;
			const prepared = yield* service.prepare([
				{
					manifest,
					sourceHash,
					compiledScripts: [],
					slug: manifest.metadata.slug,
					version: manifest.metadata.version,
					key: `user:${manifest.metadata.slug}:${sourceHash}`,
				},
			]);
			const error = yield* service.persist(UserId.make("user-1"), prepared).pipe(Effect.flip);
			expect(error).toMatchObject({ _tag: "PluginSlugReservedError" });
			expect(yield* (yield* FakeBackupRepository).persists).toBe(0);
		});
	});
});

const packageAt = (version: string) => {
	const base = privateManifest();
	const manifest = { ...base, metadata: { ...base.metadata, version } };
	return { manifest, scripts: [], sourceHash: pluginSourceHash(manifest) };
};

describe("private package backup restore in PostgreSQL", () => {
	layer(
		PluginBackupRestore.layer.pipe(
			Layer.provide(PluginIngestionLock.layer.pipe(Layer.provide(noRevisionActivation))),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect("restores only the current package as a fresh destination revision", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const plugins = yield* PluginRepository;
				const sourceV1 = packageAt("1.0.0");
				const sourceV2 = packageAt("2.0.0");
				const sourcePluginId = yield* plugins.persist(sourceV1, {
					scope: "user",
					ownerId: "owner",
					slug: sourceV1.manifest.metadata.slug,
				});
				yield* plugins.persist(sourceV2, {
					scope: "user",
					ownerId: "owner",
					slug: sourceV2.manifest.metadata.slug,
				});
				const [current] = yield* plugins.listPrivateForUser("owner");
				expect(current?.sourceHash).toBe(sourceV2.sourceHash);
				const service = yield* PluginBackupRestore;
				const key = `user:${sourceV2.manifest.metadata.slug}:${sourceV2.sourceHash}`;
				const prepared = yield* service.prepare([
					{
						key,
						compiledScripts: [],
						manifest: sourceV2.manifest,
						sourceHash: sourceV2.sourceHash,
						slug: sourceV2.manifest.metadata.slug,
						version: sourceV2.manifest.metadata.version,
					},
				]);
				const destinationPluginId = (yield* service.persist(
					UserId.make("recipient"),
					prepared,
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
				expect(destinationRevisions[0]?.plugin_revision.sourceHash).toBe(sourceV2.sourceHash);
				expect(destinationRevisions[0]?.plugin_revision.id).not.toBe(
					sourceRevisions.find(({ sourceHash }) => sourceHash === sourceV2.sourceHash)?.id,
				);
			}),
		);
	});
});
