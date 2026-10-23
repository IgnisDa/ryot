import type {
	PluginBridgeHeader,
	PluginBridgeScreenState,
	PluginHeaderContent,
} from "@ryot-app/plugin-client-contract";

export type PageHeaderPublication = Pick<PluginBridgeHeader, "index" | "key"> & {
	readonly title: PluginHeaderContent["title"] | null;
};

export type PageScreenReadiness = Omit<PluginBridgeScreenState, "type">;
