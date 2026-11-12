import {
	type BackupAccountDataCategory,
	BackupBadRequest,
	BackupConflict,
} from "@ryot-app/contract/modules/backups/schemas";
import {
	builtinSavedViewReference,
	definitionOwner,
	type SignalSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/authored";
import { PluginId, SignalSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import type { SavedViewDefinition } from "@ryot-app/definitions/snapshot";
import { isEqual } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer, Result } from "effect";

import { AuthRepository, type PortableUserProfile } from "#modules/accounts/auth/repository";
import {
	AutomationsRepository,
	type StoredNotificationSubscription,
} from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import {
	type PluginInstallationHydratedState,
	PluginInstallationRepository,
} from "#modules/plugins/installations/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { BackupExportRepository } from "../export/repository";
import { isDefaultSystemInstallation } from "../installation-state";

const MAX_RESTORE_TARGET_INSTALLATIONS = 4_096;

export type AccountCleanlinessState = {
	readonly hasPages: boolean;
	readonly hasEvents: boolean;
	readonly hasAssistant: boolean;
	readonly hasReminders: boolean;
	readonly hasPublications: boolean;
	readonly hasIntegrations: boolean;
	readonly hasRelationships: boolean;
	readonly hasManagedAssets: boolean;
	readonly hasNonBootstrapEntities: boolean;
	readonly hasNotificationChannels: boolean;
	readonly hasCalendarSourceOverrides: boolean;
	readonly profile: null | PortableUserProfile;
	readonly savedViews: ReadonlyArray<SavedViewRecord>;
	readonly defaultPreferences: Record<string, unknown>;
	readonly expectedSavedViews: ReadonlyArray<SavedViewDefinition>;
	readonly pluginState: ReadonlyArray<PluginInstallationHydratedState>;
	readonly expectedNotificationSubscriptions: ReadonlyArray<SignalSchemaReference>;
	readonly notificationSubscriptions: ReadonlyArray<StoredNotificationSubscription>;
};

type SavedViewRecord = Effect.Success<
	ReturnType<SavedViewsRepository["Service"]["listForBackup"]>
>[number];

const sameUnorderedRecords = (actual: ReadonlyArray<unknown>, expected: ReadonlyArray<unknown>) => {
	if (actual.length !== expected.length) {
		return false;
	}
	const remaining = [...expected];
	for (const value of actual) {
		const index = remaining.findIndex((candidate) => isEqual(value, candidate));
		if (index === -1) {
			return false;
		}
		remaining.splice(index, 1);
	}
	return true;
};

export const classifyAccountCleanliness = (
	state: AccountCleanlinessState,
): null | BackupAccountDataCategory => {
	if (
		!state.profile ||
		!isEqual(
			{
				...state.profile.preferences,
				reportingTimeZone: state.defaultPreferences["reportingTimeZone"],
			},
			state.defaultPreferences,
		)
	) {
		return "preferences";
	}
	if (state.hasAssistant) {
		return "assistant";
	}
	if (state.hasPages) {
		return "pages";
	}
	if (state.hasEvents) {
		return "events";
	}
	if (state.hasReminders) {
		return "reminders";
	}
	if (state.hasRelationships) {
		return "relationships";
	}
	if (state.hasNonBootstrapEntities) {
		return "entities";
	}
	if (state.hasManagedAssets) {
		return "managed-assets";
	}
	const savedViews = state.savedViews.map(
		({
			slug,
			name,
			icon,
			sort,
			filter,
			renderer,
			settings,
			isHidden,
			isBuiltin,
			sortOrder,
			reference,
			dataSources,
			pluginInstallationId,
			arguments: argumentsValue,
		}) => ({
			slug,
			name,
			icon,
			renderer,
			settings,
			isHidden,
			isBuiltin,
			sortOrder,
			reference,
			dataSources,
			pluginInstallationId,
			sort: sort ?? undefined,
			filter: filter ?? undefined,
			arguments: argumentsValue ?? {},
		}),
	);
	const expectedSavedViews = state.expectedSavedViews.map((view) => {
		const ownerPluginId = view.pluginId;
		return {
			slug: view.slug,
			name: view.name,
			isBuiltin: true,
			icon: view.icon,
			isHidden: false,
			sort: view.sort,
			filter: view.filter,
			renderer: view.renderer,
			settings: view.settings,
			sortOrder: view.sortOrder,
			arguments: view.arguments ?? {},
			reference: builtinSavedViewReference(ownerPluginId, view.slug),
			pluginInstallationId:
				ownerPluginId === null
					? null
					: (state.pluginState.find(({ pluginId }) => pluginId === ownerPluginId)?.id ?? null),
			dataSources:
				view.dataSources === null || ownerPluginId === null
					? view.dataSources
					: Result.getOrThrow(
							mapPluginIdentityReferences(view.dataSources, (reference) =>
								reference.kind === "self"
									? { kind: "local", pluginId: PluginId.make(ownerPluginId) }
									: reference,
							),
						),
		};
	});
	if (!sameUnorderedRecords(savedViews, expectedSavedViews)) {
		return "saved-views";
	}
	const subscriptions = state.notificationSubscriptions.map(
		({ isActive, metadata, signalSchemaSlug, signalSchemaPluginId }) => ({
			isActive,
			metadata,
			signal: { slug: signalSchemaSlug, owner: definitionOwner(signalSchemaPluginId) },
		}),
	);
	const expectedSubscriptions = state.expectedNotificationSubscriptions.map((signal) => ({
		signal,
		isActive: true,
		metadata: null,
	}));
	if (!sameUnorderedRecords(subscriptions, expectedSubscriptions)) {
		return "notification-subscriptions";
	}
	if (!state.pluginState.every(isDefaultSystemInstallation)) {
		return "plugin-state";
	}
	if (state.hasCalendarSourceOverrides) {
		return "calendar-source-overrides";
	}
	if (state.hasPublications) {
		return "publications";
	}
	if (state.hasIntegrations) {
		return "integrations";
	}
	if (state.hasNotificationChannels) {
		return "notification-channels";
	}
	return null;
};

export class BackupAccountCleanliness extends Context.Service<BackupAccountCleanliness>()(
	"@ryot-app/kernel-backend/modules/backups/restore/account-cleanliness/BackupAccountCleanliness",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthRepository;
			const definitions = yield* DefinitionRepository;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const installations = yield* PluginInstallationRepository;
			const backupReads = yield* BackupExportRepository;

			const assertAccountIsClean = Effect.fn("BackupAccountCleanliness.assertAccountIsClean")(
				function* (userId: UserId) {
					const profile = yield* auth.getPortableProfile(userId);
					if (!profile) {
						return yield* new BackupBadRequest({ reason: { code: "account-not-found" } });
					}
					const snapshot = yield* definitions.getUserSnapshot(userId, { listed: true });
					const flags = yield* backupReads.inspectRestoreTarget(userId);
					if (!flags) {
						return yield* new BackupBadRequest({ reason: { code: "account-not-found" } });
					}
					const expectedSavedViews = Object.values(snapshot.savedViews);
					const expectedNotificationSubscriptions = Object.values(snapshot.signalSchemas)
						.filter(({ catalogState }) => catalogState === "active")
						.map(({ slug, pluginId }) => ({
							owner: definitionOwner(pluginId),
							slug: SignalSchemaSlug.make(slug),
						}));
					const views = yield* savedViews.listForBackup(userId, {
						limit: expectedSavedViews.length + 1,
					});
					const subscriptions = yield* automations.listNotificationSubscriptionsForBackup(userId, {
						limit: expectedNotificationSubscriptions.length + 1,
					});
					const states = yield* installations.listHydratedForUser(
						userId,
						MAX_RESTORE_TARGET_INSTALLATIONS + 1,
					);
					const category = classifyAccountCleanliness({
						...flags,
						profile,
						savedViews: views,
						expectedSavedViews,
						pluginState: states,
						expectedNotificationSubscriptions,
						notificationSubscriptions: subscriptions,
						defaultPreferences: { ...defaultUserPreferences },
					});
					if (category) {
						return yield* new BackupConflict({ reason: { category, code: "account-not-clean" } });
					}
					if (states.length > MAX_RESTORE_TARGET_INSTALLATIONS) {
						return yield* new BackupConflict({
							reason: { category: "plugin-state", code: "account-not-clean" },
						});
					}
					return undefined;
				},
			);

			return { assertAccountIsClean };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(BackupExportRepository.layer),
	);
}
