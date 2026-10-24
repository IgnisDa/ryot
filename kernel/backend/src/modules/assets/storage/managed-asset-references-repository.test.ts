import { expect, layer } from "@effect/vitest";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	type AutomationSignalPayload,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { SignalSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { assert } from "vitest";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { ManagedAssetReferencesRepository } from "./managed-asset-references-repository";

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

const referenceSources = [
	"entity",
	"translation",
	"relationship",
	"event",
	"projection",
	"clientConfig",
	"userSettings",
	"integration",
	"subscription",
	"trigger",
	"savedView",
	"savedViewDefinition",
	"run",
] as const;

const insertReferenceSource = Effect.fn(function* (
	source: (typeof referenceSources)[number],
	ownerUserId: UserId | null,
	locator: ManagedAssetLocator,
) {
	const session = yield* DatabaseSession;
	const properties = { nested: [null, { image: locator }] };
	const entityId = yield* insertEntity({
		userId: ownerUserId,
		entitySchemaSlug: "unknown",
		properties: source === "entity" ? properties : {},
	});
	switch (source) {
		case "entity":
			return;
		case "translation":
			yield* session.run((db) =>
				db.insert(tables.entityTranslation).values({ entityId, properties, language: "en" }),
			);
			return;
		case "relationship":
			yield* session.run((db) =>
				db
					.insert(tables.relationship)
					.values({
						properties,
						userId: ownerUserId,
						sourceEntityId: entityId,
						targetEntityId: entityId,
						relationshipSchemaSlug: "unknown",
					}),
			);
			return;
		case "event":
		case "projection": {
			const id = crypto.randomUUID();
			yield* session.run((db) =>
				db
					.insert(tables.event)
					.values({
						id,
						entityId,
						occurredAt: new Date(),
						eventSchemaSlug: "unknown",
						userId: ownerUserId ?? UserId.make("owner"),
						properties: source === "event" ? properties : {},
					}),
			);
			if (source === "projection") {
				const streamId = crypto.randomUUID();
				yield* session.run((db) =>
					db
						.insert(tables.eventStream)
						.values({
							entityId,
							id: streamId,
							eventSchemaSlug: "unknown",
							userId: ownerUserId ?? UserId.make("owner"),
						}),
				);
				yield* session.run((db) =>
					db.insert(tables.eventProjection).values({ streamId, properties, eventId: id }),
				);
			}
			return;
		}
		case "clientConfig":
		case "userSettings":
		case "integration":
		case "savedViewDefinition": {
			const { revisionId, installation } = yield* installRevisionPackage(
				revisionPackage(`source-${crypto.randomUUID()}`),
				ownerUserId,
			);
			if (source === "clientConfig" || source === "userSettings") {
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ [source]: properties })
						.where(eq(tables.pluginInstallation.id, installation.id)),
				);
			} else if (source === "integration") {
				yield* session.run((db) =>
					db
						.insert(tables.integration)
						.values({
							lot: "sink",
							provider: "unknown",
							userId: installation.userId,
							clientProviderSpecifics: {},
							providerSpecifics: properties,
							webhookToken: crypto.randomUUID(),
							pluginInstallationId: installation.id,
							extraSettings: { disableOnContinuousErrors: false },
						}),
				);
			} else {
				yield* session.run((db) =>
					db
						.insert(tables.definitionSavedView)
						.values({
							position: 0,
							icon: "view",
							sortOrder: 0,
							name: "Reference",
							settings: properties,
							slug: crypto.randomUUID(),
							pluginRevisionId: revisionId,
							renderer: { kind: "kernel", name: "entity-browser" },
						}),
				);
			}
			return;
		}
		case "subscription":
			yield* session.run((db) =>
				db
					.insert(tables.notificationSubscription)
					.values({
						metadata: properties,
						signalSchemaSlug: crypto.randomUUID(),
						userId: ownerUserId ?? UserId.make("owner"),
					}),
			);
			return;
		case "trigger":
		case "run": {
			const triggerId = yield* insertTrigger({
				scopeUserId: ownerUserId,
				payload: signalPayload(source === "trigger" ? properties : {}),
			});
			if (source === "run") {
				yield* insertRun({
					triggerId,
					historyPayload: properties,
					executionUserId: UserId.make("owner"),
				});
			}
			return;
		}
		case "savedView":
			yield* session.run((db) =>
				db
					.insert(tables.savedView)
					.values({
						icon: "view",
						name: "Reference",
						settings: properties,
						slug: crypto.randomUUID(),
						userId: ownerUserId ?? UserId.make("owner"),
						renderer: { kind: "kernel", name: "entity-browser" },
					}),
			);
	}
});

const insertEncryptedConfig = Effect.fn(function* (revisionId: string, ownerUserId: UserId | null) {
	const id = crypto.randomUUID();
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(tables.pluginConfigRevision)
			.values({
				id,
				ownerUserId,
				configuredKeys: [],
				payloadFingerprint: id,
				nonce: Buffer.alloc(12),
				pluginRevisionId: revisionId,
				encryptedPayload: Buffer.alloc(16),
				encryptionKeyId: sql`(select id from ${tables.pluginConfigEncryptionKey} limit 1)`,
			}),
	);
	return id;
});

layer(testLayer)((test) => {
	for (const source of referenceSources) {
		test.effect(`${source} matches only the owning scope and returns no candidate JSON`, () =>
			Effect.gen(function* () {
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const otherUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				yield* insertManagedAsset(otherUserId);
				yield* insertReferenceSource(source, otherUserId, locator);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* insertReferenceSource(source, ownerUserId, locator);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
			}),
		);
	}

	for (const source of [
		"entity",
		"translation",
		"relationship",
		"trigger",
		"run",
		"savedViewDefinition",
	] as const) {
		test.effect(`${source} retains shared references`, () =>
			Effect.gen(function* () {
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				yield* insertReferenceSource(source, null, locator);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
			}),
		);
	}

	test.effect(
		"matches exact locator objects at every depth without lax coercion or path interpolation",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				yield* insertManagedAsset(ownerUserId);
				for (const type of ["s3", "local"] as const) {
					const locator: ManagedAssetLocator = {
						type,
						key: `permanent/quote"\\.'[$key]\n雪-${crypto.randomUUID()}`,
					};
					const entityId = yield* insertEntity({
						properties: {},
						userId: ownerUserId,
						entitySchemaSlug: "unknown",
					});
					const invalid: ReadonlyArray<JsonValue> = [
						null,
						true,
						42,
						"text",
						[],
						[type, locator.key],
						{ type: [type], key: locator.key },
						{ type, key: [locator.key] },
						{ type: [type], key: [locator.key] },
						{ type: {}, key: locator.key },
						{ type, key: null },
						{ type: null, key: locator.key },
						{ key: locator.key, type: type === "s3" ? "local" : "s3" },
						{ type, key: `${locator.key}-other` },
						{ type, key: locator.key.toUpperCase() },
						[{ type }, { key: locator.key }],
						{ type, nested: { key: locator.key } },
						{ wrapper: [{ type }, { key: locator.key }] },
					];
					for (const value of invalid) {
						yield* session.run((db) =>
							db
								.update(tables.entity)
								.set({ properties: sql`${JSON.stringify(value)}::jsonb` })
								.where(eq(tables.entity.id, entityId)),
						);
						expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
					}
					for (const value of [
						locator,
						{ ...locator, extra: null },
						[locator],
						[[null, [locator]]],
						{ 'escaped"\\.[*]': [null, "text", { child: locator }] },
						{ missing: {}, later: locator, malformed: { type: [], key: null } },
					]) {
						yield* session.run((db) =>
							db
								.update(tables.entity)
								.set({ properties: sql`${JSON.stringify(value)}::jsonb` })
								.where(eq(tables.entity.id, entityId)),
						);
						expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
					}
				}
			}),
	);

	test.effect(
		"negative lookup ignores unregistered locators among hundreds of candidate rows",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* session.run((db) =>
					db.insert(tables.entity).values(
						Array.from({ length: 250 }, () => {
							const id = crypto.randomUUID();
							return {
								id,
								name: id,
								userId: ownerUserId,
								entitySchemaSlug: "unknown",
								properties: { nested: [unregisteredLocator()] },
							};
						}),
					),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
			}),
	);

	test.effect("run history belongs to its trigger scope, not its execution user", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const otherUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* insertManagedAsset(otherUserId);
			const triggerId = yield* insertTrigger({
				scopeUserId: otherUserId,
				payload: signalPayload({}),
			});
			yield* insertRun({
				triggerId,
				executionUserId: ownerUserId,
				historyPayload: { image: locator },
			});
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
		}),
	);

	test.effect("projection ownership comes from its event, not its entity or stream", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const otherUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* insertManagedAsset(otherUserId);
			const entityId = yield* insertEntity({
				properties: {},
				userId: ownerUserId,
				entitySchemaSlug: "unknown",
			});
			const eventId = crypto.randomUUID();
			const streamId = crypto.randomUUID();
			yield* session.run((db) =>
				db
					.insert(tables.event)
					.values({
						entityId,
						id: eventId,
						userId: otherUserId,
						occurredAt: new Date(),
						eventSchemaSlug: "unknown",
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.eventStream)
					.values({ entityId, id: streamId, userId: otherUserId, eventSchemaSlug: "unknown" }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.eventProjection)
					.values({ eventId, streamId, properties: { image: locator } }),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
			yield* session.run((db) =>
				db.update(tables.entity).set({ userId: otherUserId }).where(eq(tables.entity.id, entityId)),
			);
			yield* session.run((db) =>
				db.update(tables.event).set({ userId: ownerUserId }).where(eq(tables.event.id, eventId)),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
		}),
	);
});

layer(ManagedAssetReferencesRepository.layer.pipe(Layer.provideMerge(makeRevisionDatabaseLayer())))(
	(test) => {
		test.effect("encrypted configurations follow declared object and array schema paths only", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const otherUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				yield* insertManagedAsset(otherUserId);
				const schema: AppSchema = {
					unknownKeys: "strict",
					fields: {
						'escaped"\\.[]': {
							type: "array",
							label: "Array",
							description: "Array",
							items: {
								type: "object",
								label: "Object",
								description: "Object",
								properties: { image: managedAssetProperty },
							},
						},
					},
				};
				const packageValue = revisionPackage(`encrypted-${crypto.randomUUID()}`);
				const { revisionId, installation } = yield* installRevisionPackage(
					{ ...packageValue, manifest: { ...packageValue.manifest, configSchema: schema } },
					ownerUserId,
				);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ activeConfigRevisionId: null })
						.where(eq(tables.pluginInstallation.id, installation.id)),
				);
				yield* session.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptedPayload: null, payloadPrunedAt: new Date() })
						.where(eq(tables.pluginConfigRevision.pluginRevisionId, revisionId)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* insertEncryptedConfig(revisionId, otherUserId);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				const configId = yield* insertEncryptedConfig(revisionId, ownerUserId);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
				yield* session.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptedPayload: null, payloadPrunedAt: new Date() })
						.where(eq(tables.pluginConfigRevision.id, configId)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ activeConfigRevisionId: configId })
						.where(eq(tables.pluginInstallation.id, installation.id)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
			}),
		);

		test.effect("missing active schemas retain assets while pruned archived payloads do not", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				const { pluginId, revisionId, installation } = yield* installRevisionPackage(
					revisionPackage(`missing-${crypto.randomUUID()}`),
					ownerUserId,
				);
				const configId = yield* insertEncryptedConfig(revisionId, ownerUserId);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ activeConfigRevisionId: configId })
						.where(eq(tables.pluginInstallation.id, installation.id)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* session.run((db) =>
					db
						.update(tables.plugin)
						.set({ status: "inactive", activeRevisionId: null })
						.where(eq(tables.plugin.id, pluginId)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
			}),
		);

		test.effect("shared encrypted configurations conservatively retain assets", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				const packageValue = revisionPackage(`shared-encrypted-${crypto.randomUUID()}`);
				const { revisionId, installation } = yield* installRevisionPackage(
					{
						...packageValue,
						manifest: {
							...packageValue.manifest,
							configSchema: {
								...packageValue.manifest.configSchema,
								fields: { image: managedAssetProperty },
							},
						},
					},
					ownerUserId,
				);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ activeConfigRevisionId: null })
						.where(eq(tables.pluginInstallation.id, installation.id)),
				);
				yield* session.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptedPayload: null, payloadPrunedAt: new Date() })
						.where(eq(tables.pluginConfigRevision.pluginRevisionId, revisionId)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
				yield* insertEncryptedConfig(revisionId, null);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
				yield* session.run((db) =>
					db
						.update(tables.pluginConfigRevision)
						.set({ encryptedPayload: null, payloadPrunedAt: new Date() })
						.where(eq(tables.pluginConfigRevision.pluginRevisionId, revisionId)),
				);
				expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
			}),
		);

		test.effect("schema retention ignores malformed nodes and non-schema asset markers", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const references = yield* ManagedAssetReferencesRepository;
				const ownerUserId = UserId.make(crypto.randomUUID());
				const locator = yield* insertManagedAsset(ownerUserId);
				const { pluginId, revisionId, installation } = yield* installRevisionPackage(
					revisionPackage(`schema-${crypto.randomUUID()}`),
					ownerUserId,
				);
				const [revision] = yield* session.run((db) =>
					db.select().from(tables.pluginRevision).where(eq(tables.pluginRevision.id, revisionId)),
				);
				assert(revision);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ activeConfigRevisionId: null })
						.where(eq(tables.pluginInstallation.id, installation.id)),
				);
				const cases: ReadonlyArray<readonly [JsonValue, boolean]> = [
					[null, false],
					[false, false],
					[42, false],
					[[], false],
					[{ fields: null }, false],
					[{ fields: [managedAssetProperty] }, false],
					[{ fields: { array: [], broken: null, scalar: "text" } }, false],
					[
						{ fields: { image: { ...managedAssetProperty, validation: { asset: "true" } } } },
						false,
					],
					[{ fields: { image: { type: "string", validation: { asset: true } } } }, false],
					[
						{
							fields: { image: { type: "object", properties: null, items: managedAssetProperty } },
						},
						false,
					],
					[
						{
							fields: {
								image: { items: null, type: "array", properties: { image: managedAssetProperty } },
							},
						},
						false,
					],
					[
						{
							fields: {
								image: { type: "array", items: { type: "array", items: managedAssetProperty } },
							},
						},
						true,
					],
					[{ fields: { image: managedAssetProperty } }, true],
				];
				for (const [schema, assetBearing] of cases) {
					const id = crypto.randomUUID();
					yield* session.transaction(
						Effect.gen(function* () {
							const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
								schema,
							);
							const configSchema = sql`${encoded}::jsonb`;
							yield* session.run((db) =>
								db
									.insert(tables.pluginRevision)
									.values({ ...revision, id, configSchema, contentHash: id }),
							);
							yield* session.run((db) =>
								db.insert(tables.pluginRevisionManifest).values({
									pluginRevisionId: id,
									manifest: sql`(select jsonb_set(${tables.pluginRevisionManifest.manifest}, '{configSchema}', ${configSchema})
								from ${tables.pluginRevisionManifest}
								where ${tables.pluginRevisionManifest.pluginRevisionId} = ${revisionId})`,
								}),
							);
						}),
					);
					const configId = yield* insertEncryptedConfig(id, ownerUserId);
					expect(yield* references.hasReference(ownerUserId, locator)).toBe(assetBearing);
					yield* session.run((db) =>
						db
							.update(tables.pluginConfigRevision)
							.set({ encryptedPayload: null, payloadPrunedAt: new Date() })
							.where(eq(tables.pluginConfigRevision.id, configId)),
					);
					yield* session.run((db) =>
						db
							.update(tables.plugin)
							.set({ activeRevisionId: id })
							.where(eq(tables.plugin.id, pluginId)),
					);
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ activeConfigRevisionId: configId })
							.where(eq(tables.pluginInstallation.id, installation.id)),
					);
					expect(yield* references.hasReference(ownerUserId, locator)).toBe(
						schema === null || assetBearing,
					);
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ activeConfigRevisionId: null })
							.where(eq(tables.pluginInstallation.id, installation.id)),
					);
				}
			}),
		);
	},
);

layer(testLayer)((test) => {
	test.effect("retains assets referenced only by event projection output", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			const entityId = yield* insertEntity({
				properties: {},
				userId: ownerUserId,
				entitySchemaSlug: "projection-source",
			});
			const eventId = crypto.randomUUID();
			const streamId = crypto.randomUUID();
			yield* session.run((db) =>
				db
					.insert(tables.event)
					.values({
						entityId,
						id: eventId,
						properties: {},
						userId: ownerUserId,
						occurredAt: new Date(),
						eventSchemaSlug: "source",
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.eventStream)
					.values({ entityId, id: streamId, userId: ownerUserId, eventSchemaSlug: "source" }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.eventProjection)
					.values({ eventId, streamId, properties: { image: locator } }),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(true);
			yield* session.run((db) =>
				db.delete(tables.eventProjection).where(eq(tables.eventProjection.eventId, eventId)),
			);
			expect(yield* references.hasReference(ownerUserId, locator)).toBe(false);
		}),
	);

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

	test.effect("a locator outside the schema's declared asset fields keeps it referenced", () =>
		Effect.gen(function* () {
			const references = yield* ManagedAssetReferencesRepository;
			const ownerUserId = UserId.make(crypto.randomUUID());
			const locator = yield* insertManagedAsset(ownerUserId);
			yield* insertEntity({
				userId: ownerUserId,
				properties: { notes: [{ attachment: locator }] },
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
