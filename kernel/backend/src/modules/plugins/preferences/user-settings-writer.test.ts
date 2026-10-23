import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginRequestError } from "@ryot-app/contract/modules/plugins/schemas";
import { type PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref } from "effect";
import { describe } from "vitest";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginInstallationRepository } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
	revisionPackage,
} from "../packages/revision.test-support";
import {
	PLUGIN_USER_SETTINGS_MAX_BYTES,
	PluginUserSettingsPatchError,
	PluginUserSettingsWriter,
} from "./user-settings-writer";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const generation = (userId: UserId) => ({ userId, token: "test-account-generation" });

type Invalidation = { readonly kind: "record" | "publish"; readonly userId: UserId };

class RecordedInvalidations extends Context.Service<
	RecordedInvalidations,
	{ readonly all: Effect.Effect<ReadonlyArray<Invalidation>> }
>()("test/RecordedInvalidations") {}

const recordedInvalidationsLayer = Layer.effectContext(
	Effect.gen(function* () {
		const recorded = yield* Ref.make<ReadonlyArray<Invalidation>>([]);
		const record = (kind: Invalidation["kind"]) => (userId: UserId) =>
			Ref.update(recorded, (all) => [...all, { kind, userId }]);
		return Context.make(PluginCatalogInvalidator, {
			all: Effect.void,
			recordAll: Effect.void,
			user: record("publish"),
			recordUser: record("record"),
			deliverPending: () => Effect.void,
		}).pipe(Context.add(RecordedInvalidations, { all: Ref.get(recorded) }));
	}),
);

type IngestionLock = "exclusive" | "shared";

class RecordedIngestionLocks extends Context.Service<
	RecordedIngestionLocks,
	{ readonly all: Effect.Effect<ReadonlyArray<IngestionLock>> }
>()("test/RecordedIngestionLocks") {}

const recordedIngestionLocksLayer = Layer.effectContext(
	Effect.gen(function* () {
		const plugins = yield* PluginRepository;
		const recorded = yield* Ref.make<ReadonlyArray<IngestionLock>>([]);
		const record = (lock: IngestionLock) => Ref.update(recorded, (all) => [...all, lock]);
		return Context.make(
			PluginRepository,
			PluginRepository.of({
				...plugins,
				lockIngestion: () => record("exclusive").pipe(Effect.andThen(plugins.lockIngestion())),
				lockIngestionShared: () =>
					record("shared").pipe(Effect.andThen(plugins.lockIngestionShared())),
			}),
		).pipe(Context.add(RecordedIngestionLocks, { all: Ref.get(recorded) }));
	}),
);

const writerLayer = PluginUserSettingsWriter.layer.pipe(
	Layer.provideMerge(Layer.merge(recordedInvalidationsLayer, recordedIngestionLocksLayer)),
	Layer.provideMerge(makeRevisionDatabaseLayer(16)),
);

const textField = (label: string) => ({ label, description: label, type: "string" as const });

const settingsPackage = (
	slug: string,
	userSettingsSchema: NonNullable<PluginManifest["userSettingsSchema"]>,
	version = "v1",
	packageId?: PluginPackageId,
) => {
	const plugin = revisionPackage(slug, version, `${slug}-entity`, packageId);
	return { ...plugin, manifest: { ...plugin.manifest, userSettingsSchema } };
};

const installSettingsPlugin = Effect.fn(function* (
	slug: string,
	fields: Readonly<Record<string, string>> = { theme: "Theme" },
) {
	const plugin = settingsPackage(slug, {
		unknownKeys: "strict",
		fields: Object.fromEntries(
			Object.entries(fields).map(([key, label]) => [key, textField(label)]),
		),
	});
	const installed = yield* installRevisionPackage(plugin);
	return { ...installed, plugin };
});

const installForRecipient = Effect.fn(function* (pluginId: string) {
	const session = yield* DatabaseSession;
	const plugins = yield* PluginRepository;
	const installations = yield* PluginInstallationRepository;
	const installation = yield* session
		.transaction(
			plugins
				.lockIngestion()
				.pipe(
					Effect.andThen(
						installations.upsertState({
							pluginId,
							config: {},
							sortOrder: 0,
							health: "ready",
							isHidden: false,
							userId: recipient,
						}),
					),
				),
		)
		.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
	assert(installation);
	return installation;
});

const storedSettings = Effect.fn(function* (installationId: string) {
	const [row] = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({ userSettings: tables.pluginInstallation.userSettings })
			.from(tables.pluginInstallation)
			.where(eq(tables.pluginInstallation.id, installationId)),
	);
	assert(row);
	return row.userSettings;
});

const patch = (input: {
	readonly userId: UserId;
	readonly pluginId: string;
	readonly revisionId: string;
	readonly values: Readonly<Record<string, JsonValue>>;
	readonly accountGeneration?: ReturnType<typeof generation>;
}) =>
	Effect.flatMap(PluginUserSettingsWriter, (writer) =>
		writer.patch({
			values: input.values,
			userId: input.userId,
			pluginId: input.pluginId,
			pluginRevisionId: input.revisionId,
			accountGeneration: input.accountGeneration ?? generation(input.userId),
		}),
	);

const rejected = (message: string) => new PluginUserSettingsPatchError({ message });

describe("PluginUserSettingsWriter.patch", () => {
	layer(writerLayer)((test) => {
		test.effect(
			"writes only the executing user's own installation and invalidates their catalog",
			() =>
				Effect.gen(function* () {
					const first = yield* installSettingsPlugin("settings-scope-first");
					const second = yield* installSettingsPlugin("settings-scope-second");
					const recipientFirst = yield* installForRecipient(first.pluginId);
					const before = (yield* (yield* RecordedInvalidations).all).length;

					yield* patch({
						userId: owner,
						pluginId: first.pluginId,
						values: { theme: "dark" },
						revisionId: first.revisionId,
					});

					expect(yield* storedSettings(first.installation.id)).toEqual({ theme: "dark" });
					expect(yield* storedSettings(recipientFirst.id)).toEqual({});
					expect(yield* storedSettings(second.installation.id)).toEqual({});
					expect((yield* (yield* RecordedInvalidations).all).slice(before)).toEqual([
						{ userId: owner, kind: "record" },
						{ userId: owner, kind: "publish" },
					]);

					assertExitFails(
						yield* Effect.exit(
							patch({
								userId: recipient,
								pluginId: second.pluginId,
								values: { theme: "light" },
								revisionId: second.revisionId,
							}),
						),
						rejected("Plugin installation not found"),
					);
					assertExitFails(
						yield* Effect.exit(
							patch({
								userId: owner,
								pluginId: first.pluginId,
								values: { theme: "light" },
								revisionId: second.revisionId,
							}),
						),
						rejected("Plugin installation not found"),
					);
					expect(yield* storedSettings(first.installation.id)).toEqual({ theme: "dark" });
					expect(yield* storedSettings(second.installation.id)).toEqual({});
				}),
		);

		test.effect("merges top-level keys and re-applies a replayed patch without change", () =>
			Effect.gen(function* () {
				const plugin = yield* installSettingsPlugin("settings-merge", {
					theme: "Theme",
					layout: "Layout",
				});
				const write = (values: Record<string, JsonValue>) =>
					patch({
						values,
						userId: owner,
						pluginId: plugin.pluginId,
						revisionId: plugin.revisionId,
					});

				yield* write({ theme: "dark" });
				yield* write({ layout: "grid" });
				yield* write({ theme: "dark" });

				expect(yield* storedSettings(plugin.installation.id)).toEqual({
					theme: "dark",
					layout: "grid",
				});
			}),
		);

		test.effect("limits keys to the pinned schema and validates against the active schema", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const plugins = yield* PluginRepository;
				const pinned = settingsPackage("settings-evolution", {
					unknownKeys: "strict",
					fields: {
						theme: textField("Theme"),
						limit: {
							label: "Limit",
							type: "integer",
							description: "Limit",
							validation: { maximum: 10 },
						},
					},
				});
				const installed = yield* installRevisionPackage(pinned);
				const active = settingsPackage(
					"settings-evolution",
					{
						...pinned.manifest.userSettingsSchema,
						fields: { ...pinned.manifest.userSettingsSchema.fields, layout: textField("Layout") },
					},
					"v2",
					pinned.manifest.metadata.packageId,
				);
				yield* session
					.transaction(
						plugins
							.lockIngestion()
							.pipe(Effect.andThen(plugins.persist(active, { ownerId: null, scope: "system" }))),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				const [activePlugin] = yield* session.run((db) =>
					db
						.select({ activeRevisionId: tables.plugin.activeRevisionId })
						.from(tables.plugin)
						.where(eq(tables.plugin.id, installed.pluginId)),
				);
				assert(activePlugin?.activeRevisionId);
				assert(activePlugin.activeRevisionId !== installed.revisionId);
				const write = (revisionId: string, values: Record<string, JsonValue>) =>
					patch({ values, revisionId, userId: owner, pluginId: installed.pluginId });

				assertExitFails(
					yield* Effect.exit(write(installed.revisionId, { layout: "grid" })),
					rejected("Unknown plugin user settings: layout"),
				);
				assertExitFails(
					yield* Effect.exit(write(installed.revisionId, { theme: "dark", missing: true })),
					rejected("Unknown plugin user settings: missing"),
				);
				assertExitFails(
					yield* Effect.exit(write(installed.revisionId, { limit: 11 })),
					rejected("Expected a value less than or equal to 10"),
				);
				expect(yield* storedSettings(installed.installation.id)).toEqual({});

				yield* write(activePlugin.activeRevisionId, { layout: "grid" });
				yield* write(installed.revisionId, { theme: "dark" });
				expect(yield* storedSettings(installed.installation.id)).toEqual({
					theme: "dark",
					layout: "grid",
				});
			}),
		);

		test.effect("caps merged settings documents for patches and whole-document saves", () =>
			Effect.gen(function* () {
				const writer = yield* PluginUserSettingsWriter;
				const plugin = yield* installSettingsPlugin("settings-size", {
					theme: "Theme",
					layout: "Layout",
				});
				const half = "x".repeat(PLUGIN_USER_SETTINGS_MAX_BYTES / 2);
				const write = (values: Record<string, JsonValue>) =>
					patch({
						values,
						userId: owner,
						pluginId: plugin.pluginId,
						revisionId: plugin.revisionId,
					});

				yield* write({ theme: half });
				assertExitFails(
					yield* Effect.exit(write({ layout: half })),
					rejected(`Plugin user settings exceed ${PLUGIN_USER_SETTINGS_MAX_BYTES} UTF-8 bytes`),
				);
				expect(yield* storedSettings(plugin.installation.id)).toEqual({ theme: half });

				const oversizedSave = yield* Effect.exit(
					writer.save(owner, plugin.installation.id, { theme: half, layout: half }, false),
				);
				assertExitFails(
					oversizedSave,
					new PluginRequestError({
						reason: {
							code: "validation-failed",
							diagnostics: [
								{
									phase: "validate",
									severity: "error",
									code: "invalid-user-settings",
									message: `Plugin user settings exceed ${PLUGIN_USER_SETTINGS_MAX_BYTES} UTF-8 bytes`,
								},
							],
						},
					}),
				);
				const locks = yield* RecordedIngestionLocks;
				const before = (yield* locks.all).length;
				yield* writer.save(owner, plugin.installation.id, { layout: "grid" }, false);
				expect(yield* storedSettings(plugin.installation.id)).toEqual({ layout: "grid" });
				expect((yield* locks.all).slice(before)).toEqual(["exclusive"]);
			}),
		);

		test.effect(
			"rechecks uninstalled, inactive, and incompatible installations at write time",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const plugins = yield* PluginRepository;
					const installations = yield* PluginInstallationRepository;
					const uninstalled = yield* installSettingsPlugin("settings-uninstalled");
					const inactive = yield* installSettingsPlugin("settings-inactive");
					const incompatible = yield* installSettingsPlugin("settings-incompatible");
					yield* session
						.transaction(
							Effect.all([
								installations.remove(uninstalled.installation.id),
								plugins.deactivate(inactive.pluginId),
								installations.updateHealth({
									healthReason: null,
									health: "incompatible",
									id: incompatible.installation.id,
									incompatibilityReason: "package-identity-conflict",
								}),
							]),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					const write = (plugin: typeof uninstalled) =>
						Effect.exit(
							patch({
								userId: owner,
								values: { theme: "dark" },
								pluginId: plugin.pluginId,
								revisionId: plugin.revisionId,
							}),
						);

					assertExitFails(yield* write(uninstalled), rejected("Plugin installation not found"));
					assertExitFails(yield* write(inactive), rejected("Plugin installation is unavailable"));
					assertExitFails(
						yield* write(incompatible),
						rejected("Plugin installation is unavailable"),
					);
					expect(yield* storedSettings(inactive.installation.id)).toEqual({});
					expect(yield* storedSettings(incompatible.installation.id)).toEqual({});
				}),
		);

		test.effect("rejects retired or mismatched account generations", () =>
			Effect.gen(function* () {
				const plugin = yield* installSettingsPlugin("settings-generation");
				const write = (accountGeneration: ReturnType<typeof generation>) =>
					Effect.exit(
						patch({
							userId: owner,
							accountGeneration,
							values: { theme: "dark" },
							pluginId: plugin.pluginId,
							revisionId: plugin.revisionId,
						}),
					);

				assertExitFails(
					yield* write({ userId: owner, token: "retired-account-generation" }),
					new DbError({ message: "Mutation command belongs to a retired account" }),
				);
				assertExitFails(
					yield* write(generation(recipient)),
					new DbError({
						message: "Plugin user settings account does not match the execution user",
					}),
				);
				expect(yield* storedSettings(plugin.installation.id)).toEqual({});
			}),
		);

		test.effect("serializes concurrent patches per user without the exclusive ingestion lock", () =>
			Effect.gen(function* () {
				const keys = Array.from({ length: 10 }, (_, index) => `key${index}`);
				const plugin = yield* installSettingsPlugin(
					"settings-concurrency",
					Object.fromEntries(keys.map((key) => [key, key])),
				);
				const recipientInstallation = yield* installForRecipient(plugin.pluginId);
				const locks = yield* RecordedIngestionLocks;
				const before = (yield* locks.all).length;

				yield* Effect.all(
					[
						...keys.map((key) =>
							patch({
								userId: owner,
								values: { [key]: key },
								pluginId: plugin.pluginId,
								revisionId: plugin.revisionId,
							}),
						),
						patch({
							userId: recipient,
							pluginId: plugin.pluginId,
							values: { key0: "recipient" },
							revisionId: plugin.revisionId,
						}),
					],
					{ concurrency: "unbounded" },
				);

				expect((yield* locks.all).slice(before)).toEqual(
					Array.from({ length: 11 }, () => "shared"),
				);

				expect(yield* storedSettings(plugin.installation.id)).toEqual(
					Object.fromEntries(keys.map((key) => [key, key])),
				);
				expect(yield* storedSettings(recipientInstallation.id)).toEqual({ key0: "recipient" });
			}),
		);
	});
});
