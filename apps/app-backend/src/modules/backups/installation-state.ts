import type { PluginInstallationState } from "#modules/plugins/installation-repository";

export const isDefaultSystemInstallation = (installation: PluginInstallationState) =>
	installation.pluginScope === "system" &&
	(installation.health === "ready" || installation.health === "installing") &&
	!installation.isDisabled &&
	installation.sortOrder === 0 &&
	Object.keys(installation.config).length === 0;
