import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import type { AuthSessionStore } from "#/modules/auth/service";
import { AccountSummary } from "#/modules/navigation/account-summary";
import { AppIcon } from "#/modules/navigation/app-icon";
import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";

type DesktopSidebarProps = {
	readonly isPro: boolean;
	readonly activeHome: boolean;
	readonly activeSettings: boolean;
	readonly session: AuthSessionStore;
	readonly catalog: PluginClientCatalog;
	readonly current: PluginClientCatalogEntry | null;
	readonly onNavigateSettings: () => void | Promise<void>;
	readonly onSelectWorkspace: (slug: string) => void | Promise<void>;
};

export function DesktopSidebar(props: DesktopSidebarProps) {
	return (
		<aside
			data-testid="desktop-sidebar"
			className="ui-chrome hidden w-66 shrink-0 flex-col border-r border-border bg-surface md:flex"
		>
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
				<WorkspaceSwitcher
					current={props.current}
					catalog={props.catalog}
					onSelect={props.onSelectWorkspace}
				/>

				{props.current !== null && (
					<nav aria-label="Workspace" className="mt-3">
						<Link
							to="/$pluginSlug"
							activeOptions={{ exact: true }}
							params={{ pluginSlug: props.current.slug }}
							aria-current={props.activeHome ? "page" : undefined}
							className={clsx(
								"flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text",
								props.activeHome ? "bg-nav-indicator" : "hover:bg-surface-2",
							)}
						>
							<AppIcon name="house" size={16} className="text-text-muted" />
							<span>Home</span>
						</Link>
					</nav>
				)}
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
