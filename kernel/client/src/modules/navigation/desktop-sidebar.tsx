import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { AccountSummary } from "#/modules/navigation/account-summary";
import { AppIcon } from "#/modules/navigation/app-icon";
import {
	resolvePluginRouteWorkspace,
	resolveSettingsWorkspace,
} from "#/modules/navigation/workspace-state";
import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { ClientStorage } from "#/persistence/storage";

type DesktopSidebarProps = {
	readonly initialRememberedSlug: string | null;
};

const isSettingsPath = (pathname: string) => /^\/settings(?:\/|$)/.test(pathname);

export function DesktopSidebar(props: DesktopSidebarProps) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { catalog } = usePluginCatalog();
	const { runtime, scope, server } = useRouteContext({ from: "/_authenticated" });
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const routeSlug = pathname.split("/")[1] ?? "";
	const current = settingsActive
		? resolveSettingsWorkspace(catalog, rememberedSlug)
		: resolvePluginRouteWorkspace(catalog, routeSlug);
	const homePath = current === null ? null : `/${current.slug}`;
	const homeActive = homePath !== null && (pathname === homePath || pathname === `${homePath}/`);
	const session = runtime.runSync(AuthService).session(server);

	return (
		<aside
			data-testid="desktop-sidebar"
			className="hidden w-66 shrink-0 flex-col border-r border-border bg-surface md:flex"
		>
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
				<WorkspaceSwitcher
					current={current}
					catalog={catalog}
					onSelect={async (slug) => {
						await runtime.runPromise(
							Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug)),
						);
						setRememberedSlug(slug);
						await navigate({
							replace: true,
							to: "/$pluginSlug",
							params: { pluginSlug: slug },
						});
					}}
				/>

				{current !== null && (
					<nav aria-label="Workspace" className="mt-3">
						<Link
							to="/$pluginSlug"
							activeOptions={{ exact: true }}
							params={{ pluginSlug: current.slug }}
							aria-current={homeActive ? "page" : undefined}
							className={[
								"flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text",
								homeActive ? "bg-nav-indicator" : "hover:bg-surface-2",
							].join(" ")}
						>
							<AppIcon name="house" size={16} className="text-text-muted" />
							<span>Home</span>
						</Link>
					</nav>
				)}
			</div>

			<footer className="shrink-0 border-t border-border px-3 py-3">
				<AccountSummary
					session={session}
					active={settingsActive}
					onNavigate={() => navigate({ href: "/settings" })}
				/>
			</footer>
		</aside>
	);
}
