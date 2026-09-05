import { expect, it } from "@effect/vitest";
import { CLIENT_API_VERSION } from "@ryot-app/client-plugin-contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect, Encoding, Layer } from "effect";
import { describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { DefinitionSnapshot } from "#modules/definition-registry/snapshot";

import { PluginBackupRestore } from "./backup-restore";
import { PluginIngestionLock } from "./ingestion-lock";
import { PluginInstallationRepository } from "./installation-repository";
import { pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import { PluginRevisionActivation } from "./revision-activation";
import { withRevisionDatabase } from "./revision.test-support";
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
const database = Object.create(null);
const noRevisionActivation = Layer.succeed(PluginRevisionActivation, {
	activated: () => Effect.void,
});

const makeLayer = (input?: {
	readonly definitions?: DefinitionSnapshot;
	readonly persist?: () => Effect.Effect<string>;
	readonly lockIngestion?: () => Effect.Effect<void>;
	readonly listActiveSystemSlugs?: () => Effect.Effect<Array<string>>;
}) => {
	const repositoryLayer = Layer.succeed(
		PluginRepository,
		Object.assign(Object.create(null), {
			persist: input?.persist,
			listPortablePluginMetadata: () => Effect.succeed([]),
			lockIngestion: () => input?.lockIngestion?.() ?? Effect.void,
			listActiveSystemSlugs: () => input?.listActiveSystemSlugs?.() ?? Effect.succeed([]),
		}),
	);
	const ingestionLockLayer = PluginIngestionLock.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				repositoryLayer,
				noRevisionActivation,
				Layer.mock(PluginInstallationRepository)({
					refreshClientConfigsForPlugin: () => Effect.void,
				}),
			),
		),
	);
	return PluginBackupRestore.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				repositoryLayer,
				ingestionLockLayer,
				Layer.mock(DefinitionRepository)({
					getGlobalSnapshot: Effect.succeed(input?.definitions ?? snapshot.definitions),
				}),
			),
		),
	);
};

it.effect("round-trips an invalid UTF-8 private plugin asset before persistence", () => {
	const manifest = privateManifest();
	const sourceFiles = { "client/asset.png": new Uint8Array([0x00, 0xff, 0x80, 0x41]) };
	const files = { "client/asset.png": Encoding.encodeBase64(sourceFiles["client/asset.png"]) };
	const sourceHash = pluginSourceHash(manifest, sourceFiles, []);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const prepared = yield* service.prepare([
			{
				files,
				manifest,
				sourceHash,
				compiledScripts: [],
				slug: manifest.metadata.slug,
				version: manifest.metadata.version,
				key: `user:${manifest.metadata.slug}:${sourceHash}`,
			},
		]);
		expect(prepared).toHaveLength(1);
		expect(prepared[0]?.normalized.sourceHash).toBe(sourceHash);
		expect(prepared[0]?.files).toEqual(sourceFiles);
	}).pipe(Effect.provide(makeLayer()), Effect.provideService(Database, database));
});

it.effect("prepares a private backup package with its precompiled client artifact", () => {
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
	const sourceFiles = { "client/card.tsx": new TextEncoder().encode("export default null;") };
	const encodedFiles = { "client/card.tsx": Encoding.encodeBase64(sourceFiles["client/card.tsx"]) };
	const compiledClient = fixtureClientArtifact(manifest.metadata.name);
	const sourceHash = pluginSourceHash(manifest, sourceFiles, [], compiledClient);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const prepared = yield* service.prepare([
			{
				manifest,
				sourceHash,
				compiledClient,
				files: encodedFiles,
				compiledScripts: [],
				slug: manifest.metadata.slug,
				version: manifest.metadata.version,
				key: `user:${manifest.metadata.slug}:${sourceHash}`,
			},
		]);

		expect(prepared[0]?.normalized.compiledClient).toEqual(compiledClient);
		expect(prepared[0]?.normalized.sourceHash).toBe(sourceHash);
	}).pipe(Effect.provide(makeLayer()), Effect.provideService(Database, database));
});

it.effect("rejects a private backup package whose source hash is not exact", () => {
	const manifest = privateManifest();
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const error = yield* service
			.prepare([
				{
					manifest,
					files: {},
					compiledScripts: [],
					sourceHash: "a".repeat(64),
					slug: manifest.metadata.slug,
					version: manifest.metadata.version,
					key: `user:${manifest.metadata.slug}:${"a".repeat(64)}`,
				},
			])
			.pipe(Effect.flip);
		expect(error.message).toContain("source hash");
	}).pipe(Effect.provide(makeLayer()), Effect.provideService(Database, database));
});

it.effect("rejects a definition collision before private plugin persistence", () => {
	let persists = 0;
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
	const files = {};
	const sourceHash = pluginSourceHash(manifest, files, []);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const error = yield* service
			.prepare([
				{
					files,
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
		expect(persists).toBe(0);
	}).pipe(
		Effect.provide(
			makeLayer({
				persist: () =>
					Effect.sync(() => {
						persists += 1;
						return "plugin-id";
					}),
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
		),
		Effect.provideService(Database, database),
	);
});

it.effect("restores precompiled scripts without compiling before persistence", () => {
	let persists = 0;
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
				requiredPluginConfigKeys: [] as const,
				requiredSystemConfigKeys: [] as const,
			},
		],
	};
	const sourceFiles = { [entry]: new TextEncoder().encode("export default {") };
	const files = { [entry]: Encoding.encodeBase64(sourceFiles[entry]) };
	const compiledScripts = [
		{ entry, format: 1, javascript: "export {};", source: "export default {" },
	];
	const sourceHash = pluginSourceHash(manifest, sourceFiles, compiledScripts);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const prepared = yield* service.prepare([
			{
				files,
				manifest,
				sourceHash,
				compiledScripts,
				slug: manifest.metadata.slug,
				version: manifest.metadata.version,
				key: `user:${manifest.metadata.slug}:${sourceHash}`,
			},
		]);
		expect(prepared[0]?.normalized.scripts[0]?.compiledCode).toBe("export {};");
		expect(persists).toBe(0);
	}).pipe(
		Effect.provide(
			makeLayer({
				persist: () =>
					Effect.sync(() => {
						persists += 1;
						return "plugin-id";
					}),
			}),
		),
		Effect.provideService(Database, database),
	);
});

it.effect("rejects persistence when a system slug appears after backup preparation", () => {
	let persists = 0;
	let systemSlugExists = false;
	const manifest = privateManifest();
	const files = {};
	const sourceHash = pluginSourceHash(manifest, files, []);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const prepared = yield* service.prepare([
			{
				files,
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
		expect(persists).toBe(0);
	}).pipe(
		Effect.provide(
			makeLayer({
				lockIngestion: () => Effect.sync(() => void (systemSlugExists = true)),
				persist: () =>
					Effect.sync(() => {
						persists += 1;
						return "plugin-id";
					}),
				listActiveSystemSlugs: () =>
					Effect.succeed(systemSlugExists ? [manifest.metadata.slug] : []),
			}),
		),
		Effect.provideService(Database, database),
	);
});

describe("private package backup restore in PostgreSQL", () => {
	it.effect("restores only the current package as a fresh destination revision", () => {
		const packageAt = (version: string) => {
			const base = privateManifest();
			const manifest = { ...base, metadata: { ...base.metadata, version } };
			const files = {};
			return { files, manifest, scripts: [], sourceHash: pluginSourceHash(manifest, files, []) };
		};
		const layer = PluginBackupRestore.layer.pipe(
			Layer.provide(
				Layer.mergeAll(PluginIngestionLock.layer.pipe(Layer.provide(noRevisionActivation))),
			),
		);
		return withRevisionDatabase(
			Effect.gen(function* () {
				const db = yield* Database;
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
						files: {},
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
				const sourceRevisions = yield* db
					.select()
					.from(tables.pluginRevision)
					.where(eq(tables.pluginRevision.pluginId, sourcePluginId));
				const destinationRevisions = yield* db
					.select()
					.from(tables.pluginRevision)
					.innerJoin(tables.plugin, eq(tables.plugin.id, tables.pluginRevision.pluginId))
					.where(
						and(
							eq(tables.plugin.ownerId, "recipient"),
							eq(tables.pluginRevision.pluginId, destinationPluginId ?? ""),
						),
					);
				expect(sourceRevisions).toHaveLength(2);
				expect(destinationRevisions).toHaveLength(1);
				expect(destinationRevisions[0]?.plugin_revision.sourceHash).toBe(sourceV2.sourceHash);
				expect(destinationRevisions[0]?.plugin_revision.id).not.toBe(
					sourceRevisions.find(({ sourceHash }) => sourceHash === sourceV2.sourceHash)?.id,
				);
			}).pipe(Effect.provide(layer)),
		);
	});
});
