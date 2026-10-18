import { DbError } from "@ryot-app/contract/errors";
import {
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { retainPropertySecrets } from "@ryot-app/contract/schema/property-secrets";
import { jsonByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { Context, Data, Effect, Layer } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { MutationReceipts } from "#modules/mutations/receipts";
import { DatabaseSession } from "#platform/db/session";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginInstallationRepository } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import { resolvePluginUserSettings } from "./user-settings";

export const PLUGIN_USER_SETTINGS_MAX_BYTES = 64 * 1024;

export class PluginUserSettingsPatchError extends Data.TaggedError("PluginUserSettingsPatchError")<{
	readonly message: string;
}> {}

const invalidUserSettings = (messages: ReadonlyArray<string>) =>
	new PluginRequestError({
		reason: {
			code: "validation-failed",
			diagnostics: messages.map((message) => ({
				message,
				phase: "validate" as const,
				severity: "error" as const,
				code: "invalid-user-settings",
			})),
		},
	});

export class PluginUserSettingsWriter extends Context.Service<PluginUserSettingsWriter>()(
	"PluginUserSettingsWriter",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const plugins = yield* PluginRepository;
			const installations = yield* PluginInstallationRepository;
			const invalidator = yield* PluginCatalogInvalidator;
			const receipts = yield* MutationReceipts.make;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const transaction = <A, E, R>(userId: UserId, work: Effect.Effect<A, E, R>) =>
				database.transaction(work.pipe(Effect.tap(() => invalidator.recordUser(userId)))).pipe(
					Effect.catchTag("DatabaseSessionStateError", Effect.die),
					Effect.tap(() => invalidator.user(userId)),
				);
			const persist = Effect.fn("PluginUserSettingsWriter.persist")(function* (input: {
				readonly userId: UserId;
				readonly installationId: string;
				readonly settingsSchema: AppSchema;
				readonly stored: Record<string, JsonValue>;
				readonly validated: Readonly<Record<string, unknown>>;
			}) {
				const settings = yield* resolvePluginUserSettings(
					input.settingsSchema,
					input.validated,
				).pipe(
					Effect.catchTags({
						SchemaError: Effect.die,
						PropertyValidationError: (error) =>
							invalidUserSettings(error.issues.map((issue) => issue.message)),
					}),
				);
				if ((jsonByteLength(input.stored) ?? Infinity) > PLUGIN_USER_SETTINGS_MAX_BYTES) {
					return yield* invalidUserSettings([
						`Plugin user settings exceed ${PLUGIN_USER_SETTINGS_MAX_BYTES} UTF-8 bytes`,
					]);
				}
				yield* assetReferences
					.lock([
						{
							properties: settings,
							ownerUserId: input.userId,
							propertiesSchema: input.settingsSchema,
						},
					])
					.pipe(
						Effect.catchTag(
							"ManagedAssetReferenceRejected",
							() => new PluginRequestError({ reason: { code: "asset-forbidden" } }),
						),
					);
				return yield* installations.saveUserSettings(
					input.userId,
					input.installationId,
					input.stored,
				);
			});

			const save = Effect.fn("PluginUserSettingsWriter.save")(
				(
					userId: UserId,
					installationId: string,
					values: Record<string, JsonValue>,
					reset: boolean,
				) =>
					transaction(
						userId,
						Effect.gen(function* () {
							yield* plugins.lockIngestion();
							const row = yield* installations.findUserSettings(userId, installationId);
							if (!row?.userSettingsSchema) {
								return yield* new PluginNotFoundError({
									reason: { installationId, code: "installation-not-found" },
								});
							}
							return yield* persist({
								userId,
								installationId,
								stored: reset ? {} : values,
								settingsSchema: row.userSettingsSchema,
								validated: reset
									? {}
									: retainPropertySecrets(
											row.userSettingsSchema,
											row.installation.userSettings,
											values,
										),
							});
						}),
					),
			);

			const patch = Effect.fn("PluginUserSettingsWriter.patch")(
				(input: {
					readonly userId: UserId;
					readonly pluginId: string;
					readonly pluginRevisionId: string;
					readonly accountGeneration: AccountGeneration;
					readonly values: Readonly<Record<string, JsonValue>>;
				}) =>
					transaction(
						input.userId,
						Effect.gen(function* () {
							yield* plugins.lockIngestionShared();
							yield* database.acquireUserWriteLock(input.userId);
							if (input.accountGeneration.userId !== input.userId) {
								return yield* new DbError({
									message: "Plugin user settings account does not match the execution user",
								});
							}
							yield* receipts.admitAccount(input.accountGeneration);
							const pinned = yield* installations.findUserSettingsForRevision({
								userId: input.userId,
								pluginId: input.pluginId,
								pluginRevisionId: input.pluginRevisionId,
							});
							if (!pinned) {
								return yield* new PluginUserSettingsPatchError({
									message: "Plugin installation not found",
								});
							}
							const pinnedSchema = pinned.userSettingsSchema;
							if (!pinnedSchema) {
								return yield* new PluginUserSettingsPatchError({
									message: "Plugin declares no user settings",
								});
							}
							const unknown = Object.keys(input.values).filter(
								(key) => !Object.hasOwn(pinnedSchema.fields, key),
							);
							if (unknown.length > 0) {
								return yield* new PluginUserSettingsPatchError({
									message: `Unknown plugin user settings: ${unknown.join(", ")}`,
								});
							}
							const active = yield* installations.findUserSettings(
								input.userId,
								pinned.installationId,
							);
							if (
								!active?.userSettingsSchema ||
								active.installation.incompatibilityReason !== null
							) {
								return yield* new PluginUserSettingsPatchError({
									message: "Plugin installation is unavailable",
								});
							}
							const merged = { ...active.installation.userSettings, ...input.values };
							return yield* persist({
								stored: merged,
								validated: merged,
								userId: input.userId,
								installationId: pinned.installationId,
								settingsSchema: active.userSettingsSchema,
							}).pipe(
								Effect.catchTag("PluginRequestError", (error) =>
									Effect.fail(
										new PluginUserSettingsPatchError({
											message:
												error.reason.code === "validation-failed"
													? error.reason.diagnostics.map(({ message }) => message).join("; ")
													: "Plugin user settings were rejected",
										}),
									),
								),
							);
						}),
					),
			);

			return { save, patch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
