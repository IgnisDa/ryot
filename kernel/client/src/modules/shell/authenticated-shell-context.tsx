import type { KernelShortcut } from "@ryot-app/plugin-client-contract";
import { createContext, type RefObject, useContext } from "react";

import type { EdgeResolution } from "#/modules/navigation/edge-intent";
import type { CustomizeDraftState } from "#/modules/shell/customize/use-customize-draft";
import type { PageHeaderPublication, PageScreenReadiness } from "#/modules/shell/page-presentation";
import type { SafeAreaInsets } from "#/modules/shell/safe-area";

export const RememberedWorkspaceContext = createContext<string | null | undefined>(undefined);

export type PluginHeaderState = PageHeaderPublication & { readonly owner: string };

export type PluginHeaderController = {
	readonly clear: (owner: string) => void;
	readonly activate: (owner: string) => void;
	readonly publish: (owner: string, header: PageHeaderPublication) => void;
};

export const PluginHeaderContext = createContext<PluginHeaderController | undefined>(undefined);

export const PluginTitleContext = createContext<string | null | undefined>(undefined);

export type ClientPageScreenState = PageScreenReadiness & { readonly owner: string };

export type ClientPageScreenController = {
	readonly clear: (owner: string) => void;
	readonly activate: (owner: string) => void;
	readonly publish: (owner: string, state: PageScreenReadiness | null) => void;
};

export type ClientPageOverlayController = {
	readonly clear: (owner: string) => void;
	readonly publish: (owner: string, count: number) => void;
};

export function createClientDocumentControllers(
	activeOwner: RefObject<string | null>,
	setHeader: (state: PluginHeaderState | null) => void,
	setScreen: (state: ClientPageScreenState | null) => void,
	setOverlayCount: (count: number) => void,
) {
	const header: PluginHeaderController = {
		clear: (owner) => {
			if (activeOwner.current === owner) {
				activeOwner.current = null;
				setHeader(null);
			}
		},
		publish: (owner, publication) => {
			if (activeOwner.current === owner) {
				setHeader({ owner, ...publication });
			}
		},
		activate: (owner) => {
			if (activeOwner.current !== owner) {
				setHeader(null);
				setOverlayCount(0);
			}
			activeOwner.current = owner;
		},
	};
	const screen: ClientPageScreenController = {
		clear: (owner) => {
			if (activeOwner.current === owner) {
				setScreen(null);
			}
		},
		activate: (owner) => {
			if (activeOwner.current !== owner) {
				activeOwner.current = owner;
			}
			setScreen(null);
		},
		publish: (owner, publication) => {
			if (activeOwner.current === owner) {
				setScreen(publication === null ? null : { ...publication, owner });
			}
		},
	};
	const overlay: ClientPageOverlayController = {
		clear: (owner) => {
			if (activeOwner.current === owner) {
				setOverlayCount(0);
			}
		},
		publish: (owner, count) => {
			if (activeOwner.current === owner) {
				setOverlayCount(count);
			}
		},
	};
	return { header, screen, overlay };
}

export const ClientPageScreenContext = createContext<ClientPageScreenController | undefined>(
	undefined,
);
export const ClientPageOverlayContext = createContext<ClientPageOverlayController | undefined>(
	undefined,
);

export const EdgeContext = createContext<EdgeResolution | undefined>(undefined);

export type ShellChrome = SafeAreaInsets & {
	readonly drawerId: string;
	readonly onBack: () => void;
	readonly isDrawerOpen: boolean;
	readonly onOpenDrawer: () => void;
	readonly triggerRef: RefObject<HTMLElement | null>;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
};

export const ShellChromeContext = createContext<ShellChrome | undefined>(undefined);

export type CustomizeController = {
	readonly readOnly: boolean;
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

export const useRememberedWorkspacePluginId = () => {
	const slug = useContext(RememberedWorkspaceContext);
	if (slug === undefined) {
		throw new Error("useRememberedWorkspacePluginId must be used inside AuthenticatedShell");
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

export const useClientPageScreen = () => {
	const screen = useContext(ClientPageScreenContext);
	if (screen === undefined) {
		throw new Error("useClientPageScreen must be used inside AuthenticatedShell");
	}
	return screen;
};

export const useClientPageOverlay = () => {
	const overlay = useContext(ClientPageOverlayContext);
	if (overlay === undefined) {
		throw new Error("useClientPageOverlay must be used inside AuthenticatedShell");
	}
	return overlay;
};
