import { Modal, useShortcut } from "@ryot-app/client-ui-sdk";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import {
	Outlet,
	useLocation,
	useNavigate,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { motion, useMotionValue, useTransform } from "motion/react";
import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

import { AuthService } from "#/modules/auth/service";
import { useDesktopEffect, useIsDesktop } from "#/modules/navigation/breakpoint";
import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";
import { CONTENT_SHIFT } from "#/modules/navigation/drawer-metrics";
import { EdgeGesture } from "#/modules/navigation/edge-gesture";
import { isSettingsPath, resolveEdge, type EdgeResolution } from "#/modules/navigation/edge-intent";
import { impactLight } from "#/modules/navigation/haptics";
import { historyEntry } from "#/modules/navigation/history-entry";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import { MobileHeader } from "#/modules/navigation/mobile-header";
import {
	activeSidebarKey,
	sidebarSections,
	type SidebarItem,
} from "#/modules/navigation/sidebar-sections";
import {
	isWorkspaceRoot,
	resolvePluginRouteWorkspace,
	resolveRememberedWorkspace,
} from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import type { PluginHeaderPublication } from "#/modules/plugins/plugin-host";
import { ClientStorage } from "#/persistence/storage";

const RememberedWorkspaceContext = createContext<string | null | undefined>(undefined);

type PluginHeaderState = PluginHeaderPublication & { readonly owner: string };

type PluginHeaderController = {
	readonly clear: (owner: string) => void;
	readonly publish: (owner: string, header: PluginHeaderPublication) => void;
};

const PluginHeaderContext = createContext<PluginHeaderController | undefined>(undefined);

const PluginTitleContext = createContext<string | null | undefined>(undefined);

const EdgeContext = createContext<EdgeResolution | undefined>(undefined);

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

export function AuthenticatedShell(props: {
	readonly isPro: boolean;
	readonly navigation: NavigationData;
	readonly initialRememberedSlug: string | null;
}) {
	const router = useRouter();
	const drawerId = useId();
	const navigate = useNavigate();
	const { pathname, state } = useLocation();
	const isDesktop = useIsDesktop();
	const { catalog } = usePluginCatalog();
	const progress = useMotionValue(0);
	const contentShift = useTransform(progress, [0, 1], [0, CONTENT_SHIFT]);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { backInterceptors, runtime, scope, server } = useRouteContext({ from: "/_authenticated" });
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [pluginHeader, setPluginHeader] = useState<PluginHeaderState | null>(null);
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const routeSlug = pathname.split("/")[1] ?? "";
	const routeWorkspace = resolvePluginRouteWorkspace(catalog, routeSlug);
	const current = resolveRememberedWorkspace(catalog, rememberedSlug);
	const homeActive = isWorkspaceRoot(pathname, current);
	const activeKey = useMemo(() => activeSidebarKey(pathname), [pathname]);
	const sections = useMemo(
		() => sidebarSections({ data: props.navigation, workspaceSlug: current?.slug }),
		[current?.slug, props.navigation],
	);
	const entry = historyEntry(state);
	const pluginTitle =
		pluginHeader?.owner === routeSlug &&
		pluginHeader.index === entry.index &&
		pluginHeader.key === entry.key
			? pluginHeader.title
			: null;
	const session = runtime.runSync(AuthService).session(server);
	const selectWorkspace = async (slug: string) => {
		impactLight();
		await runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug)),
		);
		setRememberedSlug(slug);
		await navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: slug } });
	};
	const navigateHome = () =>
		current === null
			? undefined
			: navigate({ to: "/$pluginSlug", params: { pluginSlug: current.slug } });
	const navigateItem = (item: SidebarItem) => {
		if (item.kind === "collection") {
			return navigate({ to: "/e/$entityId", params: { entityId: item.slug } });
		}
		return navigate({
			to: "/v/$viewSlug",
			params: { viewSlug: item.slug },
			search: { add: undefined, q: undefined },
			replace: activeKey?.startsWith("view:") === true,
		});
	};
	const interceptSearchBack = useEffectEvent(() => {
		setSearchOpen(false);
		return true;
	});
	const header = useMemo<PluginHeaderController>(
		() => ({
			publish: (owner, publication) => setPluginHeader({ owner, ...publication }),
			clear: (owner) =>
				setPluginHeader((currentHeader) => (currentHeader?.owner === owner ? null : currentHeader)),
		}),
		[],
	);

	const edge = resolveEdge({
		pathname,
		isDesktop,
		canGoBack: router.history.canGoBack(),
		atRoot: isWorkspaceRoot(pathname, routeWorkspace),
		hasPluginDocument: !settingsActive && routeWorkspace !== null,
	});

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
		if (!searchOpen) {
			return undefined;
		}
		return backInterceptors.register(interceptSearchBack);
	}, [backInterceptors, searchOpen]);
	useEffect(() => {
		if (settingsActive) {
			setDrawerOpen(false);
		}
	}, [settingsActive]);
	useDesktopEffect(() => setDrawerOpen(false));
	useShortcut("Meta+K", () => setSearchOpen(true), { enabled: !searchOpen });

	return (
		<div data-testid="authenticated-shell" className="flex h-dvh min-h-0 flex-col md:flex-row">
			<DesktopSidebar
				current={current}
				catalog={catalog}
				session={session}
				sections={sections}
				isPro={props.isPro}
				activeKey={activeKey}
				activeHome={homeActive}
				onNavigateHome={navigateHome}
				onNavigateItem={navigateItem}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onOpenSearch={() => setSearchOpen(true)}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			<EdgeGesture
				edge={edge}
				progress={progress}
				isOpen={drawerOpen}
				onBack={() => router.history.back()}
				onOpenChange={(open) => setDrawerOpen(open)}
			/>
			{!settingsActive && (
				<MobileHeader
					drawerId={drawerId}
					isOpen={drawerOpen}
					intent={edge.intent}
					triggerRef={triggerRef}
					onBack={() => router.history.back()}
					onOpen={() => setDrawerOpen(true)}
					title={pluginTitle ?? current?.name ?? "No workspace"}
				/>
			)}
			<MobileDrawer
				current={current}
				catalog={catalog}
				sections={sections}
				session={session}
				progress={progress}
				isPro={props.isPro}
				activeKey={activeKey}
				drawerId={drawerId}
				isOpen={drawerOpen}
				triggerRef={triggerRef}
				activeHome={homeActive}
				hasDrawer={!settingsActive}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onClose={() => setDrawerOpen(false)}
				onOpenSearch={() => setSearchOpen(true)}
				onNavigateItem={navigateItem}
				onNavigateSettings={() => navigate({ href: "/settings" })}
				onNavigateHome={navigateHome}
			/>
			<RememberedWorkspaceContext value={rememberedSlug}>
				<PluginHeaderContext value={header}>
					<PluginTitleContext value={pluginTitle}>
						<EdgeContext value={edge}>
							<motion.div
								inert={drawerOpen}
								style={{ x: contentShift }}
								data-testid="shell-content"
								className="min-h-0 min-w-0 flex-1 overflow-hidden"
							>
								<Outlet />
							</motion.div>
						</EdgeContext>
					</PluginTitleContext>
				</PluginHeaderContext>
			</RememberedWorkspaceContext>
			{searchOpen && (
				<Modal
					label="Command center"
					closeLabel="Close command center"
					onClose={() => setSearchOpen(false)}
					onInterceptBack={interceptSearchBack}
					containerClassName="items-center justify-center p-4"
					className="w-full max-w-xl rounded-xl border border-border bg-surface p-5 shadow-card"
				>
					<h2 className="font-display text-lg font-semibold text-text">Command center</h2>
					<p className="mt-2 text-sm text-text-muted">Command center content goes here.</p>
				</Modal>
			)}
		</div>
	);
}
