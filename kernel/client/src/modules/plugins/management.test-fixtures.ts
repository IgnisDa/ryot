import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";

import type { ManagedPluginInstallation } from "./management";

export const managedInstallation = (
	overrides: Partial<ManagedPluginInstallation> = {},
): ManagedPluginInstallation => ({
	config: {},
	sortOrder: 0,
	scope: "user",
	icon: "puzzle",
	name: "Whiskey",
	isHidden: false,
	version: "1.0.0",
	isInitialized: true,
	homeSavedView: null,
	configuredSecrets: [],
	health: "incompatible",
	contentHash: "source-hash",
	activationId: "activation",
	description: "Independent package",
	installationId: "private-installation",
	pluginId: PluginId.make("private-owner"),
	packageId: PluginPackageId.make("test/whiskey"),
	incompatibilityReason: "package-identity-conflict",
	activeRevisionId: PluginRevisionId.make("revision"),
	configSchema: { fields: {}, unknownKeys: "strict" },
	healthReason: "A system package claims this identity.",
	...overrides,
});
