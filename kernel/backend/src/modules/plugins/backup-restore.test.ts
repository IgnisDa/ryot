import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { DefinitionRegistry, type DefinitionSnapshot } from "#modules/definition-registry/service";

import { PluginBackupRestore } from "./backup-restore";
import { PluginIngestionLock } from "./ingestion-lock";
import { pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import { fixtureManifest } from "./test-support";

const privateManifest = () => ({
	...fixtureManifest(),
	crons: [],
	scripts: [],
	workflows: [],
	providers: [],
	operations: [],
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	userBootstrap: [],
	relationshipSchemas: [],
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
});

const snapshot = {
	plugins: {},
	httpRateLimits: { byKey: {}, byOrigin: {} },
	definitions: {
		savedViews: {},
		entitySchemas: {},
		signalSchemas: {},
		relationshipSchemas: {},
	},
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
};
const database = Object.create(null);

const makeLayer = (input?: {
	readonly definitions?: DefinitionSnapshot;
	readonly persist?: () => Effect.Effect<string>;
	readonly lockIngestion?: () => Effect.Effect<void>;
	readonly listActiveManifests?: () => Effect.Effect<Array<ReturnType<typeof privateManifest>>>;
}) => {
	const repositoryLayer = Layer.succeed(
		PluginRepository,
		Object.assign(Object.create(null), {
			persist: input?.persist,
			lockIngestion: () => input?.lockIngestion?.() ?? Effect.void,
			listActiveManifests: () => input?.listActiveManifests?.() ?? Effect.succeed([]),
			listPortablePluginMetadata: () => Effect.succeed([]),
		}),
	);
	const ingestionLockLayer = PluginIngestionLock.layer.pipe(Layer.provide(repositoryLayer));
	return PluginBackupRestore.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				repositoryLayer,
				ingestionLockLayer,
				Layer.mock(DefinitionRegistry)({
					replace: () => undefined,
					getSavedView: () => undefined,
					getEventSchema: () => undefined,
					getEntitySchema: () => undefined,
					getSignalSchema: () => undefined,
					getRelationshipSchema: () => undefined,
					getSnapshot: () => input?.definitions ?? snapshot.definitions,
				}),
			),
		),
	);
};

it.effect("validates and compiles an exact private backup package before persistence", () => {
	const manifest = privateManifest();
	const files = {};
	const sourceHash = pluginSourceHash(manifest, files);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const prepared = yield* service.prepare([
			{
				files,
				manifest,
				sourceHash,
				slug: manifest.metadata.slug,
				version: manifest.metadata.version,
				key: `user:${manifest.metadata.slug}:${sourceHash}`,
			},
		]);
		expect(prepared).toHaveLength(1);
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
					slug: manifest.metadata.slug,
					sourceHash: "a".repeat(64),
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
				name: "Collision",
				slug: "collision",
				eventSchemas: [],
				propertiesSchema: { fields: {} },
			},
		],
	};
	const files = {};
	const sourceHash = pluginSourceHash(manifest, files);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const error = yield* service
			.prepare([
				{
					files,
					manifest,
					sourceHash,
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
							pluginId: "system-id",
							pluginSlug: "system",
							name: "Collision",
							slug: "collision",
							eventSchemas: {},
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

it.effect("rejects compilation failure before private plugin persistence", () => {
	let persists = 0;
	const entry = "scripts/broken.sandbox.ts";
	const manifest = {
		...privateManifest(),
		scripts: [
			{
				entry,
				kind: "script" as const,
				capabilities: [] as const,
				name: "Broken script",
				slug: "fixture.broken",
				requiredPluginConfigKeys: [] as const,
				requiredSystemConfigKeys: [] as const,
			},
		],
	};
	const files = { [entry]: "export default {" };
	const sourceHash = pluginSourceHash(manifest, files);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		yield* service
			.prepare([
				{
					files,
					manifest,
					sourceHash,
					slug: manifest.metadata.slug,
					version: manifest.metadata.version,
					key: `user:${manifest.metadata.slug}:${sourceHash}`,
				},
			])
			.pipe(Effect.flip);
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
	const sourceHash = pluginSourceHash(manifest, files);
	return Effect.gen(function* () {
		const service = yield* PluginBackupRestore;
		const prepared = yield* service.prepare([
			{
				files,
				manifest,
				sourceHash,
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
				listActiveManifests: () => Effect.succeed(systemSlugExists ? [manifest] : []),
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
