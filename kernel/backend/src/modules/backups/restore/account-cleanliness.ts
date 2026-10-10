import {
	BackupBadRequest,
	BackupConflict,
	type BackupAccountDataCategory,
} from "@ryot-app/contract/modules/backups/schemas";
import {
	definitionKey,
	builtinSavedViewReference,
	definitionOwner,
	type SignalSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/language";
import { PluginId, SignalSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { isEqual } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer } from "effect";

import { AuthRepository, type PortableUserProfile } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import {
	AutomationsRepository,
	type StoredNotificationSubscription,
} from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { SavedViewDefinition } from "#modules/definitions/snapshot";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import {
	PluginInstallationRepository,
	type PluginInstallationHydratedState,
} from "#modules/plugins/installations/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { BackupExportRepository } from "../export/repository";
import { isDefaultSystemInstallation } from "../installation-state";

type StructuralRelationship = Pick<
	Effect.Success<
		ReturnType<RelationshipsRepository["Service"]["listUserRelationshipsForBackup"]>
	>[number],
	| "sourceEntityId"
	| "targetEntityId"
	| "relationshipSchemaSlug"
	| "relationshipSchemaPluginId"
	| "properties"
>;

type SavedViewRecord = Effect.Success<
	ReturnType<SavedViewsRepository["Service"]["listForBackup"]>
>[number];

export type AccountCleanlinessState = {
	readonly hasEvents: boolean;
	readonly hasIntegrations: boolean;
	readonly hasManagedAssets: boolean;
	readonly hasNotificationChannels: boolean;
	readonly hasCalendarSourceOverrides: boolean;
	readonly profile: PortableUserProfile | null;
	readonly savedViews: ReadonlyArray<SavedViewRecord>;
	readonly defaultPreferences: Record<string, unknown>;
	readonly entities: ReadonlyArray<PortableEntityRecord>;
	readonly pluginState: ReadonlyArray<PluginInstallationHydratedState>;
	readonly relationships: ReadonlyArray<StructuralRelationship>;
	readonly expectedSavedViews: ReadonlyArray<SavedViewDefinition>;
	readonly expectedNotificationSubscriptions: ReadonlyArray<SignalSchemaReference>;
	readonly expectedBootstrapRelationships: ReadonlyArray<StructuralRelationship>;
	readonly notificationSubscriptions: ReadonlyArray<StoredNotificationSubscription>;
};

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
): BackupAccountDataCategory | null => {
	if (!state.profile || !isEqual(state.profile.preferences, state.defaultPreferences)) {
		return "preferences";
	}
	if (state.hasEvents) {
		return "events";
	}
	const relationships = state.relationships.map(
		({
			properties,
			sourceEntityId,
			targetEntityId,
			relationshipSchemaSlug,
			relationshipSchemaPluginId,
		}) => ({
			properties,
			sourceEntityId,
			targetEntityId,
			relationshipSchemaSlug,
			relationshipSchemaPluginId,
		}),
	);
	if (!sameUnorderedRecords(relationships, state.expectedBootstrapRelationships)) {
		return "relationships";
	}
	const bootstrapEntities = state.entities.filter(
		(entity) => entity.provider === null && entity.externalId === null,
	);
	const bootstrapSchemaIdentities = new Set(
		bootstrapEntities.map(({ entitySchemaSlug, entitySchemaPluginId }) =>
			definitionKey("entity", definitionOwner(entitySchemaPluginId), entitySchemaSlug),
		),
	);
	if (
		bootstrapEntities.length !== state.entities.length ||
		bootstrapSchemaIdentities.size !== bootstrapEntities.length
	) {
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
			renderer,
			settings,
			isHidden,
			isBuiltin,
			sortOrder,
			reference,
			dataSources,
			pluginInstallationId,
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
			renderer: view.renderer,
			settings: view.settings,
			sortOrder: view.sortOrder,
			reference: builtinSavedViewReference(ownerPluginId, view.slug),
			pluginInstallationId:
				ownerPluginId === null
					? null
					: (state.pluginState.find(({ pluginId }) => pluginId === ownerPluginId)?.id ?? null),
			dataSources:
				view.dataSources === null || ownerPluginId === null
					? view.dataSources
					: mapPluginIdentityReferences(view.dataSources, (reference) =>
							reference.kind === "self"
								? { kind: "local", pluginId: PluginId.make(ownerPluginId) }
								: reference,
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
	if (state.hasIntegrations) {
		return "integrations";
	}
	if (state.hasNotificationChannels) {
		return "notification-channels";
	}
	return null;
};

export class BackupAccountCleanliness extends Context.Service<BackupAccountCleanliness>()(
	"BackupAccountCleanliness",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthRepository;
			const events = yield* EventsRepository;
			const entities = yield* EntitiesRepository;
			const uploads = yield* ManagedAssetsService;
			const definitions = yield* DefinitionRepository;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const integrations = yield* IntegrationsRepository;
			const relationships = yield* RelationshipsRepository;
			const notifications = yield* NotificationsRepository;
			const installations = yield* PluginInstallationRepository;
			const backupReads = yield* BackupExportRepository;

			const assertAccountIsClean = Effect.fn("BackupAccountCleanliness.assertAccountIsClean")(
				function* (userId: UserId) {
					const profile = yield* auth.getPortableProfile(userId);
					if (!profile) {
						return yield* new BackupBadRequest({ reason: { code: "account-not-found" } });
					}
					const ownedEntities = yield* entities.listUserEntitiesForBackup(userId);
					const ownedRelationships = yield* relationships.listUserRelationshipsForBackup(userId);
					const hasEvents = yield* events.hasUserEvents(userId);
					const hasManagedAssets = (yield* uploads.listManagedAssetsForOwner(userId)).length > 0;
					const views = yield* savedViews.listForBackup(userId);
					const subscriptions = yield* automations.listNotificationSubscriptionsForBackup(userId);
					const states = yield* installations.listHydratedForUser(userId);
					const hasIntegrations = yield* integrations.hasAnyForUser(userId);
					const hasNotificationChannels = yield* notifications.hasAnyForUser(userId);
					const hasCalendarSourceOverrides =
						(yield* backupReads.listCalendarSourceOverrides(userId)).length > 0;
					const snapshot = yield* definitions.getUserSnapshot(userId, { listed: true });
					const category = classifyAccountCleanliness({
						profile,
						hasEvents,
						hasIntegrations,
						hasManagedAssets,
						savedViews: views,
						pluginState: states,
						entities: ownedEntities,
						hasNotificationChannels,
						hasCalendarSourceOverrides,
						relationships: ownedRelationships,
						expectedBootstrapRelationships: [],
						notificationSubscriptions: subscriptions,
						defaultPreferences: { ...defaultUserPreferences },
						expectedSavedViews: Object.values(snapshot.savedViews),
						expectedNotificationSubscriptions: Object.values(snapshot.signalSchemas)
							.filter(({ catalogState }) => catalogState === "active")
							.map(({ slug, pluginId }) => ({
								owner: definitionOwner(pluginId),
								slug: SignalSchemaSlug.make(slug),
							})),
					});
					if (category) {
						return yield* new BackupConflict({ reason: { category, code: "account-not-clean" } });
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
