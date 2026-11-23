import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Modal, ModalClose, useValueChange } from "@ryot-app/plugin-ui-sdk";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";
import { type RefObject, useState } from "react";
import { flushSync } from "react-dom";

import type { AuthSessionStore } from "#/modules/auth/service";
import { impactHaptic } from "#/modules/device/haptics";
import { EDGE_SWIPE_WIDTH } from "#/modules/navigation/drawer-metrics";
import type { WorkspaceTarget } from "#/modules/navigation/workspace-state";
import { AccountSummary } from "#/modules/shell/account-summary";
import { type SidebarAssistant, SidebarNav } from "#/modules/shell/sidebar-nav";
import type {
	SidebarEntry,
	SidebarSectionName,
	SidebarSections,
} from "#/modules/shell/sidebar-sections";

type MobileDrawerProps = {
	readonly isPro: boolean;
	readonly isOpen: boolean;
	readonly drawerId: string;
	readonly onOpen: () => void;
	readonly onClose: () => void;
	readonly activeHome: boolean;
	readonly swipeToOpen: boolean;
	readonly onCustomize: () => void;
	readonly activeSettings: boolean;
	readonly activeKey: null | string;
	readonly onOpenSearch: () => void;
	readonly sections: SidebarSections;
	readonly session: AuthSessionStore;
	readonly navigation: NavigationData;
	readonly assistant: SidebarAssistant;
	readonly catalog: PluginClientCatalog;
	readonly onCreateCollection: () => void;
	readonly current: null | PluginClientCatalogEntry;
	readonly triggerRef: RefObject<null | HTMLElement>;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly onNavigateSettings: () => void | Promise<void>;
	readonly onNavigateItem: (item: SidebarEntry) => void | Promise<void>;
	readonly onSelectWorkspace: (workspace: WorkspaceTarget) => void | Promise<void>;
	readonly expandedSections?: undefined | Partial<Record<SidebarSectionName, boolean>>;
	readonly onToggleSection?: undefined | ((section: SidebarSectionName, expanded: boolean) => void);
};

export function MobileDrawer(props: MobileDrawerProps) {
	const t = useT();
	const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
	useValueChange(props.isOpen, (isOpen) => {
		if (!isOpen) {
			setWorkspaceSwitcherOpen(false);
		}
	});
	const close = () => {
		setWorkspaceSwitcherOpen(false);
		props.onClose();
	};
	const closeThen = (operation: () => void | Promise<void>) => {
		flushSync(close);
		queueMicrotask(() => void operation());
	};

	return (
		<Modal
			onClose={close}
			placement="left"
			open={props.isOpen}
			id={props.drawerId}
			triggerRef={props.triggerRef}
			containerClassName="ui-chrome md:hidden"
			label={t(kernelMessage("client.shell.sidebar.navigation"))}
			onSwipeOpen={() => {
				Effect.runFork(impactHaptic);
				props.onOpen();
			}}
			className="flex h-full w-[min(320px,82vw)] flex-col border-r border-border bg-surface pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] text-text shadow-card"
			swipeArea={
				props.swipeToOpen ? (
					<div
						data-testid="edge-gesture"
						style={{ width: EDGE_SWIPE_WIDTH }}
						className="fixed inset-y-0 left-0 z-30 touch-pan-y md:hidden"
					/>
				) : undefined
			}
		>
			<ModalClose className="mr-3 self-end" label={t(kernelMessage("common.action.close"))} />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<SidebarNav
					current={props.current}
					catalog={props.catalog}
					sections={props.sections}
					showSearchShortcut={false}
					activeKey={props.activeKey}
					navigation={props.navigation}
					activeHome={props.activeHome}
					onToggleSection={props.onToggleSection}
					expandedSections={props.expandedSections}
					workspaceSwitcherOpen={workspaceSwitcherOpen}
					onCustomize={() => closeThen(props.onCustomize)}
					onOpenSearch={() => closeThen(props.onOpenSearch)}
					onNavigateHome={() => closeThen(props.onNavigateHome)}
					onWorkspaceSwitcherOpenChange={setWorkspaceSwitcherOpen}
					onCreateCollection={() => closeThen(props.onCreateCollection)}
					onNavigateItem={(item) => closeThen(() => props.onNavigateItem(item))}
					assistant={{ ...props.assistant, onOpen: () => closeThen(props.assistant.onOpen) }}
					onSelectWorkspace={(workspace) => closeThen(() => props.onSelectWorkspace(workspace))}
				/>
			</div>

			<footer className="shrink-0 border-t border-border px-3 pt-3">
				<AccountSummary
					isPro={props.isPro}
					session={props.session}
					active={props.activeSettings}
					onNavigate={() => closeThen(props.onNavigateSettings)}
				/>
			</footer>
		</Modal>
	);
}
