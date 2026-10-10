import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import clsx from "clsx";
import type { ReactNode } from "react";

import type { AuthSessionStore } from "#/modules/auth/service";
import type { WorkspaceTarget } from "#/modules/navigation/workspace-state";
import { AccountSummary } from "#/modules/shell/account-summary";
import type { CustomizeSection } from "#/modules/shell/customize/customize-state";
import { SidebarNav } from "#/modules/shell/sidebar-nav";
import type { SidebarEntry, SidebarSections } from "#/modules/shell/sidebar-sections";

type DesktopSidebarProps = {
	readonly isPro: boolean;
	readonly activeHome: boolean;
	readonly activeSettings: boolean;
	readonly activeKey: string | null;
	readonly onOpenSearch: () => void;
	readonly sections: SidebarSections;
	readonly session: AuthSessionStore;
	readonly customizePanel: ReactNode;
	readonly shortcutsEnabled: boolean;
	readonly navigation: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly workspaceSwitcherOpen: boolean;
	readonly current: PluginClientCatalogEntry | null;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly onNavigateSettings: () => void | Promise<void>;
	readonly onEditSection: (section: CustomizeSection) => void;
	readonly onWorkspaceSwitcherOpenChange: (open: boolean) => void;
	readonly onSelectWorkspace: (workspace: WorkspaceTarget) => void | Promise<void>;
	readonly onNavigateItem: (item: SidebarEntry) => void | Promise<void>;
};

export function DesktopSidebar(props: DesktopSidebarProps) {
	const customizing = props.customizePanel !== null;
	return (
		<aside
			data-testid="desktop-sidebar"
			className={clsx(
				"ui-chrome hidden shrink-0 flex-col border-r border-border bg-surface md:flex",
				customizing ? "w-100" : "w-66",
			)}
		>
			{customizing ? (
				props.customizePanel
			) : (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto">
						<SidebarNav
							current={props.current}
							catalog={props.catalog}
							sections={props.sections}
							activeKey={props.activeKey}
							navigation={props.navigation}
							activeHome={props.activeHome}
							onOpenSearch={props.onOpenSearch}
							onEditSection={props.onEditSection}
							onNavigateHome={props.onNavigateHome}
							onNavigateItem={props.onNavigateItem}
							onSelectWorkspace={props.onSelectWorkspace}
							showSearchShortcut={props.shortcutsEnabled}
							showWorkspaceShortcut={props.shortcutsEnabled}
							workspaceSwitcherOpen={props.workspaceSwitcherOpen}
							onCustomize={() => props.onEditSection("workspaces")}
							onWorkspaceSwitcherOpenChange={props.onWorkspaceSwitcherOpenChange}
						/>
					</div>

					<footer className="shrink-0 border-t border-border px-3 py-3">
						<AccountSummary
							isPro={props.isPro}
							session={props.session}
							active={props.activeSettings}
							onNavigate={props.onNavigateSettings}
						/>
					</footer>
				</>
			)}
		</aside>
	);
}
