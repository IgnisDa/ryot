import { isEqual } from "@ryot/ts-utils/lodash";

import type { PortableUserProfile } from "#modules/auth/repository";
import type { StoredNotificationSubscription } from "#modules/automations/repository";
import type { SavedViewDefinition } from "#modules/definition-registry/service";
import type { PluginStateRow } from "#modules/definitions/repository";
import type { PortableEntityRecord } from "#modules/entities/repository";

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

export const classifyAccountCleanliness = (state: AccountCleanlinessState) => {
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
