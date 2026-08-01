import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import {
	BackupBadRequest,
	BackupConflict,
	type BackupAccountDataCategory,
} from "@ryot-app/contract/modules/backups/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { isEqual } from "@ryot-app/ts-utils/lodash";
import { Context, Effect, Layer } from "effect";

import { AuthRepository, type PortableUserProfile } from "#modules/auth/repository";
import {
	AutomationsRepository,
	type StoredNotificationSubscription,
} from "#modules/automations/repository";
import { ClientPagesRepository } from "#modules/client-pages/repository";
import { DefinitionRegistry, type SavedViewDefinition } from "#modules/definition-registry/service";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import {
	PluginInstallationRepository,
	type PluginInstallationHydratedState,
} from "#modules/plugins/installation-repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import { isDefaultSystemInstallation } from "../installation-state";

type StructuralRelationship = {
	readonly sourceEntityId: string;
	readonly targetEntityId: string;
	readonly relationshipSchemaSlug: string;
	readonly properties: Record<string, unknown>;
};

type SavedViewRecord = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly renderer: unknown;
	readonly settings: unknown;
	readonly dataSources: unknown;
	readonly sortOrder: number;
	readonly isBuiltin: boolean;
	readonly isDisabled: boolean;
	readonly pluginSlug: string | null;
};

export type AccountCleanlinessState = {
	readonly hasEvents: boolean;
	readonly hasIntegrations: boolean;
	readonly hasManagedAssets: boolean;
	readonly hasNotificationChannels: boolean;
	readonly hasClientRenderers?: boolean;
	readonly profile: PortableUserProfile | null;
	readonly savedViews: ReadonlyArray<SavedViewRecord>;
	readonly defaultPreferences: Record<string, unknown>;
	readonly entities: ReadonlyArray<PortableEntityRecord>;
	readonly pluginState: ReadonlyArray<PluginInstallationHydratedState>;
	readonly relationships: ReadonlyArray<StructuralRelationship>;
	readonly expectedSavedViews: ReadonlyArray<SavedViewDefinition>;
	readonly expectedNotificationSubscriptionSlugs: ReadonlyArray<string>;
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
	if (!sameUnorderedRecords(state.relationships, state.expectedBootstrapRelationships)) {
		return "relationships";
	}
	const bootstrapEntities = state.entities.filter(
		(entity) => entity.provider === null && entity.externalId === null,
	);
	const bootstrapSchemaSlugs = new Set(
		bootstrapEntities.map(({ entitySchemaSlug }) => entitySchemaSlug),
	);
	if (
		bootstrapEntities.length !== state.entities.length ||
		bootstrapSchemaSlugs.size !== bootstrapEntities.length
	) {
		return "entities";
	}
	if (state.hasManagedAssets) {
		return "managed-assets";
	}
	if (state.hasClientRenderers === true) {
		return "saved-views";
	}
	const savedViews = state.savedViews.map(
		({
			slug,
			name,
			icon,
			renderer,
			settings,
			isBuiltin,
			sortOrder,
			isDisabled,
			pluginSlug,
			dataSources,
		}) => ({
			slug,
			name,
			icon,
			renderer,
			settings,
			isBuiltin,
			sortOrder,
			isDisabled,
			pluginSlug,
			dataSources,
		}),
	);
	const expectedSavedViews = state.expectedSavedViews.map((view) => ({
		slug: view.slug,
		name: view.name,
		isBuiltin: true,
		icon: view.icon,
		isDisabled: false,
		renderer: view.renderer,
		settings: view.settings,
		sortOrder: view.sortOrder,
		pluginSlug: view.pluginSlug,
		dataSources: view.dataSources,
	}));
	if (!sameUnorderedRecords(savedViews, expectedSavedViews)) {
		return "saved-views";
	}
	const subscriptions = state.notificationSubscriptions.map(
		({ isActive, metadata, signalSchemaSlug }) => ({ isActive, metadata, signalSchemaSlug }),
	);
	const expectedSubscriptions = state.expectedNotificationSubscriptionSlugs.map(
		(signalSchemaSlug) => ({ isActive: true, metadata: null, signalSchemaSlug }),
	);
	if (!sameUnorderedRecords(subscriptions, expectedSubscriptions)) {
		return "notification-subscriptions";
	}
	if (!state.pluginState.every(isDefaultSystemInstallation)) {
		return "plugin-state";
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
			const clientPages = yield* ClientPagesRepository;
			const events = yield* EventsRepository;
			const entities = yield* EntitiesRepository;
			const uploads = yield* ManagedAssetsService;
			const definitions = yield* DefinitionRegistry;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const integrations = yield* IntegrationsRepository;
			const relationships = yield* RelationshipsRepository;
			const notifications = yield* NotificationsRepository;
			const installations = yield* PluginInstallationRepository;

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
					const hasClientRenderers = (yield* clientPages.listRenderers(userId)).length > 0;
					const subscriptions = yield* automations.listNotificationSubscriptionsForBackup(userId);
					const states = yield* installations.listHydratedForUser(userId);
					const hasIntegrations = yield* integrations.hasAnyForUser(userId);
					const hasNotificationChannels = yield* notifications.hasAnyForUser(userId);
					const snapshot = definitions.getSnapshot();
					const category = classifyAccountCleanliness({
						profile,
						hasEvents,
						hasIntegrations,
						hasManagedAssets,
						savedViews: views,
						hasClientRenderers,
						pluginState: states,
						entities: ownedEntities,
						hasNotificationChannels,
						relationships: ownedRelationships,
						expectedBootstrapRelationships: [],
						notificationSubscriptions: subscriptions,
						defaultPreferences: { ...defaultUserPreferences },
						expectedSavedViews: Object.values(snapshot.savedViews),
						expectedNotificationSubscriptionSlugs: Object.values(snapshot.signalSchemas)
							.filter(({ catalogState }) => catalogState === "active")
							.map(({ slug }) => slug),
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
	static readonly layer = Layer.effect(this, this.make);
}
