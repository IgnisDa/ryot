import { Effect, Layer } from "effect";

import { AccountApi } from "#/api/account";
import { AutomationHistoryApi } from "#/api/automation-history";
import { BackupsApi } from "#/api/backups";
import { CollectionsApi } from "#/api/collections";
import { EntityProvidersApi } from "#/api/entity-providers";
import { EntityWatchApi } from "#/api/entity-watches";
import { ImportsApi } from "#/api/imports";
import { InstanceAdminApi } from "#/api/instance-admin";
import { IntegrationsApi } from "#/api/integrations";
import { NotificationsApi } from "#/api/notifications";
import { OAuthConnectionsApi } from "#/api/oauth-connections";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginsApi } from "#/api/plugins";
import { RyotQLApi } from "#/api/ryotql";
import { SavedViewsApi } from "#/api/saved-views";
import { UploadsApi } from "#/api/uploads";
import { Uploads } from "#/modules/assets/uploads";
import { EntityWatchService } from "#/modules/entity-watches/service";
import { ExternalLinks } from "#/modules/external-links/service";
import { PluginManagementService } from "#/modules/plugins/management/service";

// oxlint-disable-next-line effecttsgo/lazy-effect -- Fills service method slots of any arity
export const unused = () => Effect.die("not used");

export const makeAutomationHistoryApi = (
	overrides: Partial<AutomationHistoryApi["Service"]> = {},
) => Layer.succeed(AutomationHistoryApi, { retryRun: unused, ...overrides });

export const makeEntityWatchApi = (overrides: Partial<EntityWatchApi["Service"]> = {}) =>
	Layer.succeed(EntityWatchApi, { createSocketTicket: unused, ...overrides });

export const makeEntityWatchService = (overrides: Partial<EntityWatchService["Service"]> = {}) =>
	Layer.succeed(EntityWatchService, {
		refresh: () => {},
		reconnect: () => {},
		acquire: () => () => {},
		watch: () => ({ update: () => {}, dispose: () => {} }),
		...overrides,
	});

export const makeRyotQLApi = (overrides: Partial<RyotQLApi["Service"]> = {}) =>
	Layer.succeed(RyotQLApi, { execute: unused, executePlugin: unused, ...overrides });

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
) =>
	Layer.succeed(PluginInstallationsApi, {
		update: unused,
		uninstall: unused,
		updatePackage: unused,
		...overrides,
	});

export const makeUploadsApi = (overrides: Partial<UploadsApi["Service"]> = {}) =>
	Layer.fresh(Uploads.layer).pipe(
		Layer.provideMerge(
			Layer.succeed(UploadsApi, {
				cleanup: unused,
				putBytes: unused,
				createIntent: unused,
				completeIntent: unused,
				resolveDownloads: unused,
				...overrides,
			}),
		),
	);

export const makePluginsApi = (overrides: Partial<PluginsApi["Service"]> = {}) =>
	Layer.succeed(PluginsApi, {
		invoke: unused,
		saveUserSettings: unused,
		resetUserSettings: unused,
		...overrides,
	});

export const makeEntityProvidersApi = (overrides: Partial<EntityProvidersApi["Service"]> = {}) =>
	Layer.succeed(EntityProvidersApi, {
		search: unused,
		import: unused,
		searchOptions: unused,
		getImportResult: unused,
		...overrides,
	});

export const makeImportsApi = (overrides: Partial<ImportsApi["Service"]> = {}) =>
	Layer.succeed(ImportsApi, {
		createRun: unused,
		cancelRun: unused,
		deleteRun: unused,
		downloadIssues: unused,
		...overrides,
	});

export const makeBackupsApi = (overrides: Partial<BackupsApi["Service"]> = {}) =>
	Layer.succeed(BackupsApi, {
		deleteRun: unused,
		createExport: unused,
		createRestore: unused,
		downloadArchive: unused,
		...overrides,
	});

export const makeIntegrationsApi = (overrides: Partial<IntegrationsApi["Service"]> = {}) =>
	Layer.succeed(IntegrationsApi, {
		sync: unused,
		create: unused,
		delete: unused,
		update: unused,
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

export const makeOAuthConnectionsApi = (overrides: Partial<OAuthConnectionsApi["Service"]> = {}) =>
	Layer.succeed(OAuthConnectionsApi, {
		create: unused,
		status: unused,
		complete: unused,
		...overrides,
	});

export const makeAccountApi = (overrides: Partial<AccountApi["Service"]> = {}) =>
	Layer.succeed(AccountApi, {
		refreshAvatar: unused,
		twoFactorStatus: unused,
		updatePreferences: unused,
		...overrides,
	});

export const makeInstanceAdminApi = (overrides: Partial<InstanceAdminApi["Service"]> = {}) =>
	Layer.succeed(InstanceAdminApi, {
		query: unused,
		listLogs: unused,
		resetUser: unused,
		deleteUser: unused,
		downloadLogs: unused,
		setUserDisabled: unused,
		resetUserPassword: unused,
		startUserImpersonation: unused,
		...overrides,
	});

export const KernelApiTestLayer = Layer.mergeAll(
	Layer.succeed(PluginManagementService, { load: unused, execute: unused }),
	Layer.succeed(ExternalLinks, {
		open: () => Effect.die("Unused external link"),
		outcome: () => Effect.die("Unused external link"),
	}),
	makeAutomationHistoryApi(),
	makeRyotQLApi(),
	makeCollectionsApi(),
	makeImportsApi(),
	makeBackupsApi(),
	makeUploadsApi(),
	makePluginsApi(),
	makeSavedViewsApi(),
	makeAccountApi(),
	makeIntegrationsApi(),
	makeNotificationsApi(),
	makeOAuthConnectionsApi(),
	makeEntityWatchApi(),
	makeEntityProvidersApi(),
	makeEntityWatchService(),
	makePluginInstallationsApi(),
);
