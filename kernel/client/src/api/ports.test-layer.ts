import { Effect, Layer } from "effect";

import { GodModeApi } from "#/api/god-mode";
import { ImportsApi } from "#/api/imports";
import { IntegrationsApi } from "#/api/integrations";
import { PluginsApi } from "#/api/plugins";
import { ProviderEntitiesApi } from "#/api/provider-entities";
import { RyotQLApi } from "#/api/ryotql";
import { SavedViewsApi } from "#/api/saved-views";
import { UploadsApi } from "#/api/uploads";
import { UserSettingsApi } from "#/api/user-settings";

export const unused = () => Effect.die("not used");

export const makeRyotQLApi = (overrides: Partial<RyotQLApi["Service"]> = {}) =>
	Layer.succeed(RyotQLApi, { execute: unused, ...overrides });

export const makeSavedViewsApi = (overrides: Partial<SavedViewsApi["Service"]> = {}) =>
	Layer.succeed(SavedViewsApi, { update: unused, reorder: unused, ...overrides });

export const makeUploadsApi = (overrides: Partial<UploadsApi["Service"]> = {}) =>
	Layer.succeed(UploadsApi, {
		createIntent: unused,
		completeIntent: unused,
		resolveDownloads: unused,
		...overrides,
	});

export const makePluginsApi = (overrides: Partial<PluginsApi["Service"]> = {}) =>
	Layer.succeed(PluginsApi, {
		invoke: unused,
		renewArtifactSession: unused,
		revokeArtifactSession: unused,
		createArtifactSession: unused,
		...overrides,
	});

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
	makeRyotQLApi(),
	makeImportsApi(),
	makeUploadsApi(),
	makePluginsApi(),
	makeSavedViewsApi(),
	makeUserSettingsApi(),
	makeIntegrationsApi(),
	makeProviderEntitiesApi(),
);
