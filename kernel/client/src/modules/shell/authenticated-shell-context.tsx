import type { KernelShortcut } from "@ryot-app/plugin-client-contract";
import { createContext, type RefObject, useContext } from "react";

import type { EdgeResolution } from "#/modules/navigation/edge-intent";
import type { historyEntry } from "#/modules/navigation/history-entry";
import type { CustomizeDraftState } from "#/modules/shell/customize/use-customize-draft";
import type { PageHeaderPublication, PageScreenReadiness } from "#/modules/shell/page-presentation";
import type { SafeAreaInsets } from "#/modules/shell/safe-area";

export const RememberedWorkspaceContext = createContext<null | string | undefined>(undefined);

export const PluginTitleContext = createContext<null | string | undefined>(undefined);

export type ClientPagePresentationState = {
	readonly owner: null | string;
	readonly overlayCount: number;
	readonly header: null | PageHeaderPublication;
	readonly readiness: null | PageScreenReadiness;
};

export const emptyClientPagePresentation: ClientPagePresentationState = {
	owner: null,
	header: null,
	readiness: null,
	overlayCount: 0,
};

export const matchesEntry = (
	publication: ReturnType<typeof historyEntry>,
	entry: ReturnType<typeof historyEntry>,
) => publication.index === entry.index && publication.key === entry.key;

export type ClientPagePresentationController = ReturnType<
	typeof createClientPagePresentationController
>;

export function createClientPagePresentationController(
	setPresentation: (state: ClientPagePresentationState) => void,
) {
	let state = emptyClientPagePresentation;
	const publish = (next: ClientPagePresentationState) => {
		state = next;
		setPresentation(state);
	};
	return {
		activate: (owner: string) => publish({ ...emptyClientPagePresentation, owner }),
		deactivate: (owner: string) => {
			if (state.owner === owner) {
				publish(emptyClientPagePresentation);
			}
		},
		publishHeader: (owner: string, header: PageHeaderPublication) => {
			if (state.owner === owner) {
				publish({ ...state, header });
			}
		},
		publishOverlayCount: (owner: string, overlayCount: number) => {
			if (state.owner === owner) {
				publish({ ...state, overlayCount });
			}
		},
		publishReadiness: (owner: string, readiness: null | PageScreenReadiness) => {
			if (state.owner === owner) {
				publish({ ...state, readiness });
			}
		},
	};
}

export const ClientPagePresentationContext = createContext<
	undefined | ClientPagePresentationController
>(undefined);

export const EdgeContext = createContext<undefined | EdgeResolution>(undefined);

export type ShellChrome = SafeAreaInsets & {
	readonly drawerId: string;
	readonly onBack: () => void;
	readonly isDrawerOpen: boolean;
	readonly onOpenDrawer: () => void;
	readonly triggerRef: RefObject<null | HTMLElement>;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
};

export const ShellChromeContext = createContext<undefined | ShellChrome>(undefined);

export type CustomizeController = {
	readonly readOnly: boolean;
	readonly onSave: () => void;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
};

export const CustomizeContext = createContext<undefined | CustomizeController>(undefined);

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

export const useClientPagePresentation = () => {
	const presentation = useContext(ClientPagePresentationContext);
	if (presentation === undefined) {
		throw new Error("useClientPagePresentation must be used inside AuthenticatedShell");
	}
	return presentation;
};
