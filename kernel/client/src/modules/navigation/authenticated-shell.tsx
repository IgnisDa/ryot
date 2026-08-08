import {
	Outlet,
	useLocation,
	useNavigate,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { useMotionValue } from "motion/react";
import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState,
} from "react";

import { AuthService } from "#/modules/auth/service";
import { useDesktopEffect } from "#/modules/navigation/breakpoint";
import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";
import { EdgeGesture } from "#/modules/navigation/edge-gesture";
import { isSettingsPath, resolveEdgeIntent } from "#/modules/navigation/edge-intent";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import { MobileHeader } from "#/modules/navigation/mobile-header";
import {
	resolvePluginRouteWorkspace,
	resolveRememberedWorkspace,
} from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { ClientStorage } from "#/persistence/storage";

const RememberedWorkspaceContext = createContext<string | null | undefined>(undefined);

const PluginHeaderContext = createContext<((title: string | null) => void) | undefined>(undefined);

export const useRememberedWorkspaceSlug = () => {
	const slug = useContext(RememberedWorkspaceContext);
	if (slug === undefined) {
		throw new Error("useRememberedWorkspaceSlug must be used inside AuthenticatedShell");
	}
	return slug;
};

export const useSetPluginHeaderTitle = () => {
	const setTitle = useContext(PluginHeaderContext);
	if (setTitle === undefined) {
		throw new Error("useSetPluginHeaderTitle must be used inside AuthenticatedShell");
	}
	return setTitle;
};

export function AuthenticatedShell(props: {
	readonly isPro: boolean;
	readonly initialRememberedSlug: string | null;
}) {
	const router = useRouter();
	const drawerId = useId();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { catalog } = usePluginCatalog();
	const progress = useMotionValue(0);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { backInterceptors, runtime, scope, server } = useRouteContext({ from: "/_authenticated" });
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [pluginTitle, setPluginTitle] = useState<string | null>(null);
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const routeSlug = pathname.split("/")[1] ?? "";
	const routeWorkspace = resolvePluginRouteWorkspace(catalog, routeSlug);
	const current = settingsActive
		? resolveRememberedWorkspace(catalog, rememberedSlug)
		: routeWorkspace;
	const homePath = current === null ? null : `/${current.slug}`;
	const homeActive = homePath !== null && (pathname === homePath || pathname === `${homePath}/`);
	const session = runtime.runSync(AuthService).session(server);
	const rememberRouteWorkspace = useEffectEvent((slug: string) => {
		if (slug === rememberedSlug) {
			return;
		}
		setRememberedSlug(slug);
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug)),
		);
	});
	const selectWorkspace = async (slug: string) => {
		await runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug)),
		);
		setRememberedSlug(slug);
		await navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: slug } });
	};

	const edgeIntent = resolveEdgeIntent({
		pathname,
		atRoot: homeActive,
		canGoBack: router.history.canGoBack(),
	});

	useEffect(() => {
		if (routeWorkspace !== null && !routeWorkspace.isDisabled) {
			rememberRouteWorkspace(routeWorkspace.slug);
		}
	}, [routeWorkspace]);
	useEffect(() => {
		if (!drawerOpen) {
			return undefined;
		}
		return backInterceptors.register(() => {
			setDrawerOpen(false);
			return true;
		});
	}, [backInterceptors, drawerOpen]);
	useEffect(() => {
		if (settingsActive) {
			setDrawerOpen(false);
		}
	}, [settingsActive]);
	useDesktopEffect(() => setDrawerOpen(false));

	return (
		<div data-testid="authenticated-shell" className="flex h-dvh min-h-0 flex-col md:flex-row">
			<DesktopSidebar
				current={current}
				catalog={catalog}
				session={session}
				isPro={props.isPro}
				activeHome={homeActive}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			<EdgeGesture
				progress={progress}
				intent={edgeIntent}
				isOpen={drawerOpen}
				onBack={() => router.history.back()}
				onOpenChange={(open) => setDrawerOpen(open)}
			/>
			{!settingsActive && (
				<MobileHeader
					drawerId={drawerId}
					isOpen={drawerOpen}
					intent={edgeIntent}
					triggerRef={triggerRef}
					onBack={() => router.history.back()}
					onOpen={() => setDrawerOpen(true)}
					title={pluginTitle ?? current?.name ?? "No workspace"}
				/>
			)}
			<MobileDrawer
				current={current}
				catalog={catalog}
				session={session}
				progress={progress}
				isPro={props.isPro}
				drawerId={drawerId}
				isOpen={drawerOpen}
				triggerRef={triggerRef}
				activeHome={homeActive}
				hasDrawer={!settingsActive}
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
			<RememberedWorkspaceContext value={rememberedSlug}>
				<PluginHeaderContext value={setPluginTitle}>
					<div data-testid="shell-content" className="min-h-0 min-w-0 flex-1 overflow-hidden">
						<Outlet />
					</div>
				</PluginHeaderContext>
			</RememberedWorkspaceContext>
		</div>
	);
}
