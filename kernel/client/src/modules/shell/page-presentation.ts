import type {
	PluginBridgeHeader,
	PluginBridgeScreenState,
	PluginHeaderContent,
} from "@ryot-app/plugin-client-contract";

export type PageScreenReadiness = Omit<PluginBridgeScreenState, "type">;

export type PageHeaderPublication = Pick<PluginBridgeHeader, "key" | "index"> & {
	readonly title: null | PluginHeaderContent["title"];
};
