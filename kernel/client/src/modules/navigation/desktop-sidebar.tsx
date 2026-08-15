import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";

import type { AuthSessionStore } from "#/modules/auth/service";
import { AccountSummary } from "#/modules/navigation/account-summary";
import { SidebarNav } from "#/modules/navigation/sidebar-nav";
import type { SidebarItem, SidebarSections } from "#/modules/navigation/sidebar-sections";

type DesktopSidebarProps = {
	readonly isPro: boolean;
	readonly activeHome: boolean;
	readonly activeSettings: boolean;
	readonly activeKey: string | null;
	readonly onOpenSearch: () => void;
	readonly sections: SidebarSections;
	readonly session: AuthSessionStore;
	readonly catalog: PluginClientCatalog;
	readonly current: PluginClientCatalogEntry | null;
	readonly onNavigateHome: () => void | Promise<void>;
	readonly onNavigateSettings: () => void | Promise<void>;
	readonly onSelectWorkspace: (slug: string) => void | Promise<void>;
	readonly onNavigateItem: (item: SidebarItem) => void | Promise<void>;
};

export function DesktopSidebar(props: DesktopSidebarProps) {
	return (
		<aside
			data-testid="desktop-sidebar"
			className="ui-chrome hidden w-66 shrink-0 flex-col border-r border-border bg-surface md:flex"
		>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<SidebarNav
					showSearchShortcut
					current={props.current}
					catalog={props.catalog}
					sections={props.sections}
					activeKey={props.activeKey}
					activeHome={props.activeHome}
					onOpenSearch={props.onOpenSearch}
					onNavigateHome={props.onNavigateHome}
					onNavigateItem={props.onNavigateItem}
					onSelectWorkspace={props.onSelectWorkspace}
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
		</aside>
	);
}
