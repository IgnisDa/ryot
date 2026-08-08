import { Outlet, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useId, useRef, useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import { MobileHeader } from "#/modules/navigation/mobile-header";
import {
	resolvePluginRouteWorkspace,
	resolveSettingsWorkspace,
} from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { ClientStorage } from "#/persistence/storage";

const isSettingsPath = (pathname: string) => /^\/settings(?:\/|$)/.test(pathname);

export function AuthenticatedShell(props: { readonly initialRememberedSlug: string | null }) {
	const drawerId = useId();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { catalog } = usePluginCatalog();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { runtime, scope, server } = useRouteContext({ from: "/_authenticated" });
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const routeSlug = pathname.split("/")[1] ?? "";
	const current = settingsActive
		? resolveSettingsWorkspace(catalog, rememberedSlug)
		: resolvePluginRouteWorkspace(catalog, routeSlug);
	const homePath = current === null ? null : `/${current.slug}`;
	const homeActive = homePath !== null && (pathname === homePath || pathname === `${homePath}/`);
	const session = runtime.runSync(AuthService).session(server);
	const selectWorkspace = async (slug: string) => {
		await runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug)),
		);
		setRememberedSlug(slug);
		await navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: slug } });
	};

	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			return undefined;
		}
		const desktop = window.matchMedia("(min-width: 768px)");
		const closeOnDesktop = () => {
			if (desktop.matches) {
				setDrawerOpen(false);
			}
		};
		closeOnDesktop();
		desktop.addEventListener("change", closeOnDesktop);
		return () => desktop.removeEventListener("change", closeOnDesktop);
	}, []);

	return (
		<div data-testid="authenticated-shell" className="flex h-dvh min-h-0 flex-col md:flex-row">
			<DesktopSidebar
				current={current}
				catalog={catalog}
				session={session}
				activeHome={homeActive}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			{!settingsActive && (
				<MobileHeader
					current={current}
					drawerId={drawerId}
					isOpen={drawerOpen}
					triggerRef={triggerRef}
					onOpen={() => setDrawerOpen(true)}
				/>
			)}
			{!settingsActive && (
				<MobileDrawer
					current={current}
					catalog={catalog}
					session={session}
					drawerId={drawerId}
					isOpen={drawerOpen}
					triggerRef={triggerRef}
					activeHome={homeActive}
					activeSettings={settingsActive}
					onSelectWorkspace={selectWorkspace}
					onClose={() => setDrawerOpen(false)}
					onNavigateSettings={() => navigate({ href: "/settings" })}
					onNavigateHome={() =>
						current === null
							? undefined
							: navigate({ to: "/$pluginSlug", params: { pluginSlug: current.slug } })
					}
				/>
			)}
			<div data-testid="shell-content" className="min-h-0 min-w-0 flex-1 overflow-hidden">
				<Outlet />
			</div>
		</div>
	);
}
