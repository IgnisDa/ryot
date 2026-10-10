import { expect, layer } from "@effect/vitest";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	type AutomationSignalPayload,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { ManagedAssetReferencesRepository } from "./managed-asset-references-repository";
import { insertManagedAsset, managedAssetProperty } from "./managed-assets.test-support";

const testLayer = ManagedAssetReferencesRepository.layer.pipe(
	Layer.provideMerge(revisionDatabaseLayer),
);

const unregisteredLocator = (): ManagedAssetLocator => ({
	type: "s3",
	key: `permanent/${crypto.randomUUID()}.png`,
});

const signalPayload = (properties: Record<string, JsonValue>): AutomationSignalPayload => ({
	properties,
	actorUserId: null,
	operation: "emit",
	category: "signal",
	resource: "signal",
	signalSchemaPluginId: null,
	signalSchemaSlug: SignalSchemaSlug.make("unknown.signal"),
});

const insertEntity = Effect.fn(function* (input: {
	readonly entitySchemaSlug: string;
	readonly properties: Record<string, unknown>;
	readonly userId: UserId | null;
}) {
	const id = crypto.randomUUID();
	yield* (yield* DatabaseSession).run((db) =>
		db.insert(tables.entity).values({ ...input, id, name: id, entitySchemaPluginId: null }),
	);
	return id;
});

const insertKernelAssetSchema = Effect.fn(function* () {
	const slug = `asset-schema-${crypto.randomUUID()}`;
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.definitionEntitySchema)
			.values({
				slug,
				icon: "box",
				position: 0,
				name: "Asset schema",
				pluginRevisionId: null,
				mergeIdentityProperties: [],
				propertiesSchema: { fields: { image: managedAssetProperty } },
			}),
	);
	return slug;
});

const insertTrigger = Effect.fn(function* (input: {
	readonly payload: AutomationSignalPayload;
	readonly scopeUserId: UserId | null;
}) {
	const id = crypto.randomUUID();
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.automationTrigger)
			.values({
				...input,
				id,
				depth: 0,
				source: "api",
				executionId: id,
				operation: "emit",
				category: "signal",
				rootExecutionId: id,
				lane: "interactive",
				resourceKind: "signal",
				occurredAt: new Date(),
				initiatorKind: "system",
			}),
	);
	return id;
});

const insertRun = Effect.fn(function* (input: {
	readonly executionUserId: UserId;
	readonly historyPayload: JsonValue;
	readonly triggerId: string;
}) {
	const id = crypto.randomUUID();
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.automationRun)
			.values({
				...input,
				id,
				hookSlug: id,
				hookName: id,
				stage: "after",
				delivery: "async",
				status: "succeeded",
				scriptContentHash: "hash",
				scriptSlug: "kernel.fixture",
				artifactsExpireAt: new Date(),
				retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
			}),
	);
});

layer(testLayer)((test) => {
	test.effect("other users' rows holding other locators do not block cleanup", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const otherUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			const otherLocator = yield* insertManagedAsset(otherUserId);
			const entityId = yield* insertEntity({
				userId: otherUserId,
				properties: { image: otherLocator },
				entitySchemaSlug: `unknown-${crypto.randomUUID()}`,
			});
			yield* session.run((db) =>
				db
					.insert(tables.entityTranslation)
					.values({ entityId, language: "en", properties: { image: otherLocator } }),
			);
			const triggerId = yield* insertTrigger({
				scopeUserId: otherUserId,
				payload: signalPayload({ image: otherLocator }),
			});
			yield* insertRun({
				triggerId,
				executionUserId: otherUserId,
				historyPayload: { image: otherLocator },
			});
			yield* session.run((db) =>
				db
					.insert(tables.savedView)
					.values({
						icon: "view",
						name: "Other view",
						userId: otherUserId,
						slug: crypto.randomUUID(),
						settings: { image: otherLocator },
						renderer: { kind: "kernel", name: "entity-browser" },
					}),
			);
			const { installation } = yield* installRevisionPackage(
				revisionPackage(`other-${crypto.randomUUID()}`),
				otherUserId,
			);
			yield* session.run((db) =>
				db
					.update(tables.pluginInstallation)
					.set({ clientConfig: { image: otherLocator }, userSettings: { image: otherLocator } })
					.where(eq(tables.pluginInstallation.id, installation.id)),
			);
			yield* session.run((db) =>
				db
					.insert(tables.integration)
					.values({
						lot: "sink",
						userId: otherUserId,
						clientProviderSpecifics: {},
						provider: "unknown-provider",
						webhookToken: crypto.randomUUID(),
						pluginInstallationId: installation.id,
						providerSpecifics: { image: otherLocator },
						extraSettings: { disableOnContinuousErrors: false },
					}),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
		}),
	);

	test.effect("an unscoped trigger holding a different locator does not block cleanup", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* insertTrigger({
				scopeUserId: null,
				payload: signalPayload({ image: unregisteredLocator() }),
			});
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
		}),
	);

	test.effect("the owner's entity holding the locator keeps it referenced", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* insertEntity({
				userId: ownerUserId,
				properties: { image: locator },
				entitySchemaSlug: yield* insertKernelAssetSchema(),
			});
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);

	test.effect("a translation of the owner's entity holding the locator keeps it referenced", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			const entityId = yield* insertEntity({
				properties: {},
				userId: ownerUserId,
				entitySchemaSlug: yield* insertKernelAssetSchema(),
			});
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.entityTranslation)
					.values({ entityId, language: "en", properties: { image: locator } }),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);

	test.effect("another user's run from the owner's trigger keeps the locator referenced", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const otherUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* insertManagedAsset(otherUserId);
			const triggerId = yield* insertTrigger({
				scopeUserId: ownerUserId,
				payload: signalPayload({}),
			});
			yield* insertRun({
				triggerId,
				executionUserId: otherUserId,
				historyPayload: { image: locator },
			});
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);

	test.effect("a kernel saved view definition holding the locator keeps it referenced", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.definitionSavedView)
					.values({
						position: 0,
						sortOrder: 0,
						icon: "view",
						name: "Kernel view",
						pluginRevisionId: null,
						slug: crypto.randomUUID(),
						settings: { image: locator },
						renderer: { kind: "kernel", name: "entity-browser" },
					}),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);

	test.effect("an owner's unknown-schema row blocks cleanup only for its exact locator", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			const entityId = yield* insertEntity({
				userId: ownerUserId,
				properties: { image: unregisteredLocator() },
				entitySchemaSlug: `unknown-${crypto.randomUUID()}`,
			});
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
			yield* session.run((db) =>
				db
					.update(tables.entity)
					.set({ properties: { nested: [{ image: locator }] } })
					.where(eq(tables.entity.id, entityId)),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);

	test.effect("an environment config revision without asset fields does not block cleanup", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			const { revisionId } = yield* installRevisionPackage(
				revisionPackage(`environment-${crypto.randomUUID()}`),
			);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.pluginConfigRevision)
					.values({
						ownerUserId: null,
						configuredKeys: [],
						nonce: Buffer.alloc(12),
						encryptionKeyId: "test-key",
						pluginRevisionId: revisionId,
						payloadFingerprint: "fingerprint",
						encryptedPayload: Buffer.alloc(16),
					}),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
		}),
	);
});
