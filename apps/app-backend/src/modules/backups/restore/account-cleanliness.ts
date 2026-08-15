import { defaultUserPreferences } from "@ryot/contract/auth-middleware";
import {
	BackupBadRequest,
	BackupConflict,
	type BackupAccountDataCategory,
} from "@ryot/contract/modules/backups/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { isEqual } from "@ryot/ts-utils/lodash";
import { Context, Effect, Layer } from "effect";

import { AuthRepository, type PortableUserProfile } from "#modules/auth/repository";
import {
	AutomationsRepository,
	type StoredNotificationSubscription,
} from "#modules/automations/repository";
import { DefinitionRegistry, type SavedViewDefinition } from "#modules/definition-registry/service";
import { DefinitionsRepository, type PluginStateRow } from "#modules/definitions/repository";
import { EntitiesRepository, type PortableEntityRecord } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import { V1_BOOTSTRAP_SOURCE } from "../archive-v1/schemas";

type StructuralEntity = Pick<
	PortableEntityRecord,
	"name" | "properties" | "externalId" | "populatedAt" | "provider" | "entitySchemaSlug"
>;

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
	readonly layouts: unknown;
	readonly sortOrder: number;
	readonly isBuiltin: boolean;
	readonly isDisabled: boolean;
	readonly pluginSlug: string | null;
	readonly entitySchemaSlug: string | null;
};

export type AccountCleanlinessState = {
	readonly hasEvents: boolean;
	readonly hasIntegrations: boolean;
	readonly hasManagedAssets: boolean;
	readonly hasNotificationChannels: boolean;
	readonly profile: PortableUserProfile | null;
	readonly pluginState: ReadonlyArray<PluginStateRow>;
	readonly savedViews: ReadonlyArray<SavedViewRecord>;
	readonly defaultPreferences: Record<string, unknown>;
	readonly entities: ReadonlyArray<PortableEntityRecord>;
	readonly relationships: ReadonlyArray<StructuralRelationship>;
	readonly expectedSavedViews: ReadonlyArray<SavedViewDefinition>;
	readonly expectedBootstrapEntities: ReadonlyArray<StructuralEntity>;
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
	const entities = state.entities.map(
		({ name, properties, externalId, populatedAt, provider, entitySchemaSlug }) => ({
			name,
			provider,
			properties,
			externalId,
			populatedAt,
			entitySchemaSlug,
		}),
	);
	if (!sameUnorderedRecords(entities, state.expectedBootstrapEntities)) {
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
			layouts,
			isBuiltin,
			sortOrder,
			isDisabled,
			pluginSlug,
			entitySchemaSlug,
		}) => ({
			slug,
			name,
			icon,
			layouts,
			isBuiltin,
			sortOrder,
			isDisabled,
			pluginSlug,
			entitySchemaSlug,
		}),
	);
	const expectedSavedViews = state.expectedSavedViews.map((view) => ({
		...view,
		isBuiltin: true,
		isDisabled: false,
	}));
	if (!sameUnorderedRecords(savedViews, expectedSavedViews)) {
		return "saved-views";
	}
	const subscriptions = state.notificationSubscriptions.map(
		({ signalSchemaSlug, isActive, metadata }) => ({ signalSchemaSlug, isActive, metadata }),
	);
	const expectedSubscriptions = state.expectedNotificationSubscriptionSlugs.map(
		(signalSchemaSlug) => ({ signalSchemaSlug, isActive: true, metadata: null }),
	);
	if (!sameUnorderedRecords(subscriptions, expectedSubscriptions)) {
		return "notification-subscriptions";
	}
	if (state.pluginState.length > 0) {
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
			const events = yield* EventsRepository;
			const uploads = yield* ManagedAssetsService;
			const entities = yield* EntitiesRepository;
			const definitions = yield* DefinitionRegistry;
			const savedViews = yield* SavedViewsRepository;
			const automations = yield* AutomationsRepository;
			const pluginState = yield* DefinitionsRepository;
			const integrations = yield* IntegrationsRepository;
			const relationships = yield* RelationshipsRepository;
			const notifications = yield* NotificationsRepository;

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
					const states = yield* pluginState.listPluginStates(userId);
					const hasIntegrations = yield* integrations.hasAnyForUser(userId);
					const hasNotificationChannels = yield* notifications.hasAnyForUser(userId);
					const snapshot = definitions.getSnapshot();
					const sourceDefinition = snapshot.entitySchemas[V1_BOOTSTRAP_SOURCE.entitySchemaSlug];
					if (
						sourceDefinition?.pluginSlug !== V1_BOOTSTRAP_SOURCE.pluginSlug ||
						sourceDefinition.name !== V1_BOOTSTRAP_SOURCE.name
					) {
						return yield* new BackupBadRequest({
							reason: { code: "bootstrap-definition-unavailable" },
						});
					}
					const category = classifyAccountCleanliness({
						profile,
						hasEvents,
						hasIntegrations,
						hasManagedAssets,
						savedViews: views,
						pluginState: states,
						entities: ownedEntities,
						hasNotificationChannels,
						relationships: ownedRelationships,
						expectedBootstrapRelationships: [],
						notificationSubscriptions: subscriptions,
						defaultPreferences: { ...defaultUserPreferences },
						expectedSavedViews: Object.values(snapshot.savedViews),
						expectedBootstrapEntities: [
							{
								provider: null,
								properties: {},
								externalId: null,
								populatedAt: null,
								name: V1_BOOTSTRAP_SOURCE.name,
								entitySchemaSlug: V1_BOOTSTRAP_SOURCE.entitySchemaSlug,
							},
						],
						expectedNotificationSubscriptionSlugs: Object.values(snapshot.signalSchemas)
							.filter(({ catalogState }) => catalogState === "active")
							.map(({ slug }) => slug),
					});
					if (category) {
						return yield* new BackupConflict({
							reason: { code: "account-not-clean", category },
						});
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
