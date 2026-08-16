import { createContext, useContext, type RefObject } from "react";

import type { CustomizeDraftState } from "#/modules/navigation/customize/use-customize-draft";
import type { EdgeResolution } from "#/modules/navigation/edge-intent";
import type { PluginHeaderPublication } from "#/modules/plugins/plugin-host";

export const RememberedWorkspaceContext = createContext<string | null | undefined>(undefined);

export type PluginHeaderState = PluginHeaderPublication & { readonly owner: string };

export type PluginHeaderController = {
	readonly clear: (owner: string) => void;
	readonly publish: (owner: string, header: PluginHeaderPublication) => void;
};

export const PluginHeaderContext = createContext<PluginHeaderController | undefined>(undefined);

export const PluginTitleContext = createContext<string | null | undefined>(undefined);

export const EdgeContext = createContext<EdgeResolution | undefined>(undefined);

export type ShellChrome = {
	readonly drawerId: string;
	readonly onBack: () => void;
	readonly safeAreaTop: number;
	readonly isDrawerOpen: boolean;
	readonly onOpenDrawer: () => void;
	readonly triggerRef: RefObject<HTMLElement | null>;
};

export const ShellChromeContext = createContext<ShellChrome | undefined>(undefined);

export type CustomizeController = {
	readonly onSave: () => void;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
};

export const CustomizeContext = createContext<CustomizeController | undefined>(undefined);

export const useShellChrome = () => {
	const chrome = useContext(ShellChromeContext);
	if (chrome === undefined) {
		throw new Error("useShellChrome must be used inside AuthenticatedShell");
	}
	return chrome;
};

export const useCustomizeController = () => {
	const controller = useContext(CustomizeContext);
	if (controller === undefined) {
		throw new Error("useCustomizeController must be used inside AuthenticatedShell");
	}
	return controller;
};

export const useEdge = () => {
	const edge = useContext(EdgeContext);
	if (edge === undefined) {
		throw new Error("useEdge must be used inside AuthenticatedShell");
	}
	return edge;
};

export const useRememberedWorkspaceSlug = () => {
	const slug = useContext(RememberedWorkspaceContext);
	if (slug === undefined) {
		throw new Error("useRememberedWorkspaceSlug must be used inside AuthenticatedShell");
	}
	return slug;
};

export const usePluginTitle = () => {
	const title = useContext(PluginTitleContext);
	if (title === undefined) {
		throw new Error("usePluginTitle must be used inside AuthenticatedShell");
	}
	return title;
};

export const usePluginHeader = () => {
	const header = useContext(PluginHeaderContext);
	if (header === undefined) {
		throw new Error("usePluginHeader must be used inside AuthenticatedShell");
	}
	return header;
};
