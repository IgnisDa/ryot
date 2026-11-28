import { badRequest, DbError, validationFailed } from "@ryot-app/contract/errors";
import {
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import {
	PLUGIN_USER_SETTINGS_MAX_BYTES,
	resolvePluginUserSettings,
} from "@ryot-app/contract/modules/plugins/user-settings";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { retainPropertySecrets } from "@ryot-app/contract/schema/property-secrets";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { DatabaseSession } from "#platform/db/session";
import type { WriteTransaction } from "#platform/db/write-transaction";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginInstallationRepository } from "../installations/repository";
import { PluginRepository } from "../packages/repository";
import {
	isPluginUserSettingsTooLarge,
	pluginUserSettingsTooLargeMessage,
} from "./user-settings-size";

class PluginUserSettingsTooLarge extends Schema.TaggedError<
	PluginUserSettingsTooLarge,
	{ readonly brand: unique symbol }
>()("PluginUserSettingsTooLarge", {}) {}

export class PluginUserSettingsPatchError extends Schema.TaggedError<
	PluginUserSettingsPatchError,
	{ readonly brand: unique symbol }
>()("PluginUserSettingsPatchError", { message: Schema.String }) {}

export class PluginUserSettingsWriter extends Context.Service<PluginUserSettingsWriter>()(
	"@ryot-app/kernel-backend/modules/plugins/preferences/user-settings-writer/PluginUserSettingsWriter",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const plugins = yield* PluginRepository;
			const installations = yield* PluginInstallationRepository;
			const invalidator = yield* PluginCatalogInvalidator;
			const admission = yield* AccountAdmission.make;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const transaction = <A, E, R>(userId: UserId, work: Effect.Effect<A, E, R>) =>
				database
					.transaction(work.pipe(Effect.tap(() => invalidator.user(userId))))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const persist = Effect.fn("PluginUserSettingsWriter.persist")(function* (input: {
				readonly userId: UserId;
				readonly installationId: string;
				readonly stored: Record<string, JsonValue>;
				readonly settingsSchema: AppSchema<unknown>;
				readonly validated: Readonly<Record<string, unknown>>;
			}) {
				const settings = yield* resolvePluginUserSettings(
					input.settingsSchema,
					input.validated,
				).pipe(Effect.catchTag("SchemaError", Effect.die));
				if (isPluginUserSettingsTooLarge(input.stored)) {
					return yield* new PluginUserSettingsTooLarge();
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
							yield* plugins.lockIngestionForUser(userId);
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
							}).pipe(
								Effect.catchTags({
									PropertyValidationError: (error) =>
										validationFailed(
											error.issues.map(({ path }) => ({ path, issue: "invalid-value" as const })),
										),
									PluginUserSettingsTooLarge: () =>
										badRequest(
											kernelMessage("error.plugins.user-settings-too-large", {
												maxBytes: PLUGIN_USER_SETTINGS_MAX_BYTES,
											}),
										),
								}),
							);
						}),
					),
			);

			type PatchInput = {
				readonly userId: UserId;
				readonly pluginId: string;
				readonly accountUserId: UserId;
				readonly pluginRevisionId: string;
				readonly values: Readonly<Record<string, JsonValue>>;
			};
			/**
			 * Takes a patch's locks. A transaction takes them before its catalog lock, which holds the
			 * installation row the patch updates shared.
			 */
			const lockForPatch = Effect.fn("PluginUserSettingsWriter.lockForPatch")(function* (
				userId: UserId,
				writes: WriteTransaction,
			) {
				yield* plugins.lockIngestionShared([userId], writes);
				yield* database.acquireUserWriteLock(userId);
			});
			/** Patches inside the caller's transaction, which holds `lockForPatch`. */
			const patchWithin = Effect.fn("PluginUserSettingsWriter.patchWithin")(function* (
				input: PatchInput,
				writes?: WriteTransaction,
			) {
				if (input.accountUserId !== input.userId) {
					return yield* new DbError({
						message: "Plugin user settings account does not match the execution user",
					});
				}
				yield* admission.admitAccount(input.accountUserId, writes);
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
				const active = yield* installations.findUserSettings(input.userId, pinned.installationId);
				if (!active?.userSettingsSchema || active.installation.incompatibilityReason !== null) {
					return yield* new PluginUserSettingsPatchError({
						message: "Plugin installation is unavailable",
					});
				}
				const merged = { ...active.installation.userSettings, ...input.values };
				const saved = yield* persist({
					stored: merged,
					validated: merged,
					userId: input.userId,
					installationId: pinned.installationId,
					settingsSchema: active.userSettingsSchema,
				}).pipe(
					Effect.catchTags({
						PluginRequestError: () =>
							new PluginUserSettingsPatchError({ message: "Plugin user settings were rejected" }),
						PluginUserSettingsTooLarge: () =>
							new PluginUserSettingsPatchError({ message: pluginUserSettingsTooLargeMessage }),
						PropertyValidationError: (error) =>
							new PluginUserSettingsPatchError({
								message: error.issues.map(({ message }) => message).join("; "),
							}),
					}),
				);
				yield* invalidator.user(input.userId);
				return saved;
			});

			return { save, patchWithin, lockForPatch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
