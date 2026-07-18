import { Effect, Layer } from "effect";

import { AutomationHistoryApi } from "#/api/automation-history";
import { BackupsApi } from "#/api/backups";
import { CollectionsApi } from "#/api/collections";
import { EntityInterestApi } from "#/api/entity-interest";
import { GodModeApi } from "#/api/god-mode";
import { ImportsApi } from "#/api/imports";
import { IntegrationsApi } from "#/api/integrations";
import { NotificationsApi } from "#/api/notifications";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginsApi } from "#/api/plugins";
import { ProviderEntitiesApi } from "#/api/provider-entities";
import { RyotQLApi } from "#/api/ryotql";
import { SavedViewsApi } from "#/api/saved-views";
import { UploadsApi } from "#/api/uploads";
import { UserSettingsApi } from "#/api/user-settings";
import { EntityInterestService } from "#/modules/entity-interest/service";

export const unused = () => Effect.die("not used");

export const makeAutomationHistoryApi = (
	overrides: Partial<AutomationHistoryApi["Service"]> = {},
) =>
	Layer.succeed(AutomationHistoryApi, {
		getRun: unused,
		listRuns: unused,
		retryRun: unused,
		...overrides,
	});

export const makeEntityInterestApi = (overrides: Partial<EntityInterestApi["Service"]> = {}) =>
	Layer.succeed(EntityInterestApi, { createSocketTicket: unused, ...overrides });

export const makeEntityInterestService = (
	overrides: Partial<EntityInterestService["Service"]> = {},
) =>
	Layer.succeed(EntityInterestService, {
		refresh: () => {},
		reconnect: () => {},
		acquire: () => () => {},
		watch: () => ({ update: () => {}, dispose: () => {} }),
		...overrides,
	});

export const makeRyotQLApi = (overrides: Partial<RyotQLApi["Service"]> = {}) =>
	Layer.succeed(RyotQLApi, { execute: unused, ...overrides });

export const makeCollectionsApi = (overrides: Partial<CollectionsApi["Service"]> = {}) =>
	Layer.succeed(CollectionsApi, {
		create: unused,
		createMembership: unused,
		deleteMembership: unused,
		...overrides,
	});

export const makeSavedViewsApi = (overrides: Partial<SavedViewsApi["Service"]> = {}) =>
	Layer.succeed(SavedViewsApi, { update: unused, reorder: unused, ...overrides });

export const makePluginInstallationsApi = (
	overrides: Partial<PluginInstallationsApi["Service"]> = {},
) => Layer.succeed(PluginInstallationsApi, { update: unused, ...overrides });

export const makeUploadsApi = (overrides: Partial<UploadsApi["Service"]> = {}) =>
	Layer.succeed(UploadsApi, {
		createIntent: unused,
		completeIntent: unused,
		resolveDownloads: unused,
		...overrides,
	});

export const makePluginsApi = (overrides: Partial<PluginsApi["Service"]> = {}) =>
	Layer.succeed(PluginsApi, { invoke: unused, ...overrides });

export const makeProviderEntitiesApi = (overrides: Partial<ProviderEntitiesApi["Service"]> = {}) =>
	Layer.succeed(ProviderEntitiesApi, {
		search: unused,
		import: unused,
		searchOptions: unused,
		getImportResult: unused,
		...overrides,
	});

export const makeImportsApi = (overrides: Partial<ImportsApi["Service"]> = {}) =>
	Layer.succeed(ImportsApi, {
		createRun: unused,
		deleteRun: unused,
		listSources: unused,
		...overrides,
	});

export const makeBackupsApi = (overrides: Partial<BackupsApi["Service"]> = {}) =>
	Layer.succeed(BackupsApi, {
		listRuns: unused,
		deleteRun: unused,
		createExport: unused,
		createRestore: unused,
		downloadArchive: unused,
		...overrides,
	});

export const makeIntegrationsApi = (overrides: Partial<IntegrationsApi["Service"]> = {}) =>
	Layer.succeed(IntegrationsApi, {
		get: unused,
		sync: unused,
		create: unused,
		delete: unused,
		update: unused,
		listProviders: unused,
		...overrides,
	});

export const makeNotificationsApi = (overrides: Partial<NotificationsApi["Service"]> = {}) =>
	Layer.succeed(NotificationsApi, {
		testChannels: unused,
		createChannel: unused,
		updateChannel: unused,
		deleteChannel: unused,
		...overrides,
	});

export const makeUserSettingsApi = (overrides: Partial<UserSettingsApi["Service"]> = {}) =>
	Layer.succeed(UserSettingsApi, {
		get: unused,
		refreshAvatar: unused,
		updatePreferences: unused,
		...overrides,
	});

export const makeGodModeApi = (overrides: Partial<GodModeApi["Service"]> = {}) =>
	Layer.succeed(GodModeApi, {
		listUsers: unused,
		resetUser: unused,
		deleteUser: unused,
		setUserDisabled: unused,
		resetUserPassword: unused,
		getMigrationReport: unused,
		getUserLifecycleOperation: unused,
		...overrides,
	});

export const KernelApiTestLayer = Layer.mergeAll(
	makeAutomationHistoryApi(),
	makeRyotQLApi(),
	makeCollectionsApi(),
	makeImportsApi(),
	makeBackupsApi(),
	makeUploadsApi(),
	makePluginsApi(),
	makeSavedViewsApi(),
	makeUserSettingsApi(),
	makeIntegrationsApi(),
	makeNotificationsApi(),
	makeEntityInterestApi(),
	makeProviderEntitiesApi(),
	makeEntityInterestService(),
	makePluginInstallationsApi(),
);
