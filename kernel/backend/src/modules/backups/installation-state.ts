import type { PluginInstallationHydratedState } from "#modules/plugins/installations/repository";

export const isDefaultSystemInstallation = (installation: PluginInstallationHydratedState) =>
	installation.pluginScope === "system" &&
	(installation.health === "ready" || installation.health === "installing") &&
	!installation.isHidden &&
	installation.homeSavedView === null &&
	installation.sortOrder === 0 &&
	Object.keys(installation.config).length === 0 &&
	Object.keys(installation.userSettings).length === 0;
