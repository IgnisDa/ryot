import {
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	PluginSlug,
} from "@ryot-app/contract/schema/brands";

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
	sourceHash: "source-hash",
	activationId: "activation",
	slug: PluginSlug.make("whiskey"),
	description: "Independent package",
	installationId: "private-installation",
	pluginId: PluginId.make("private-owner"),
	incompatibilityReason: "package-identity-conflict",
	activeRevisionId: PluginRevisionId.make("revision"),
	configSchema: { fields: {}, unknownKeys: "strict" },
	healthReason: "A system package claims this identity.",
	packageId: PluginPackageId.make("570e77e1-e450-40ea-b1cb-6e2ae3223bb3"),
	...overrides,
});
