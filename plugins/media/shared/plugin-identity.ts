import { PluginPackageId } from "@ryot-app/plugin-kit/schema";

export const PLUGIN_PACKAGE_ID = PluginPackageId.make("ryot/media");

export const declaredQuerySource = (query: string) =>
	({ query, scope: "system", packageId: PLUGIN_PACKAGE_ID }) as const;
