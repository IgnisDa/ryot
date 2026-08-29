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
	type RefObject,
} from "react";

import { AuthService } from "#/modules/auth/service";
import { useDesktopEffect, useIsDesktop } from "#/modules/navigation/breakpoint";
import { CustomizeSidebarPanel } from "#/modules/navigation/customize/customize-sidebar-panel";
import {
	customizeSearchSection,
	type CustomizeSection,
} from "#/modules/navigation/customize/customize-state";
import {
	useCustomizeDraft,
	type CustomizeDraftState,
} from "#/modules/navigation/customize/use-customize-draft";
import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";
import { CONTENT_SHIFT } from "#/modules/navigation/drawer-metrics";
import { EdgeGesture } from "#/modules/navigation/edge-gesture";
import {
	hasWorkspaceChrome,
	isCustomizeSidebarPath,
	isSettingsPath,
	resolveEdge,
	type EdgeResolution,
} from "#/modules/navigation/edge-intent";
import { impactLight } from "#/modules/navigation/haptics";
import { historyEntry } from "#/modules/navigation/history-entry";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import { useSafeAreaTop } from "#/modules/navigation/safe-area";
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

export type ShellChrome = {
	readonly drawerId: string;
	readonly onBack: () => void;
	readonly safeAreaTop: number;
	readonly isDrawerOpen: boolean;
	readonly onOpenDrawer: () => void;
	readonly triggerRef: RefObject<HTMLElement | null>;
};

const ShellChromeContext = createContext<ShellChrome | undefined>(undefined);

export const useShellChrome = () => {
	const chrome = useContext(ShellChromeContext);
	if (chrome === undefined) {
		throw new Error("useShellChrome must be used inside AuthenticatedShell");
	}
	return chrome;
};

export type CustomizeController = {
	readonly onSave: () => void;
	readonly onLeave: () => void;
	readonly customize: CustomizeDraftState;
};

const CustomizeContext = createContext<CustomizeController | undefined>(undefined);

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
	const drawerId = useId();
	const router = useRouter();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const safeAreaTop = useSafeAreaTop();
	const { catalog } = usePluginCatalog();
	const progress = useMotionValue(0);
	const { pathname, search, state } = useLocation();
	const contentShift = useTransform(progress, [0, 1], [0, CONTENT_SHIFT]);
	const triggerRef = useRef<HTMLElement>(null);
	const { backInterceptors, runtime, scope, server } = useRouteContext({ from: "/_authenticated" });
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [pluginHeader, setPluginHeader] = useState<PluginHeaderState | null>(null);
	const [discarding, setDiscarding] = useState(false);
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const customizeActive = isCustomizeSidebarPath(pathname);
	const customizeSection = customizeSearchSection(search);
	const workspaceChrome = hasWorkspaceChrome(pathname);
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
	const interceptDiscardBack = useEffectEvent(() => {
		setDiscarding(false);
		return true;
	});
	const customize = useCustomizeDraft({
		catalog,
		data: props.navigation,
		active: customizeActive,
		workspaceSlug: current?.slug,
	});
	const openCustomize = (section: CustomizeSection) => {
		void navigate({ to: "/customize-sidebar", search: { section } });
	};
	const leaveCustomize = () => {
		setDiscarding(false);
		if (router.history.canGoBack()) {
			router.history.back();
			return;
		}
		void (current === null
			? navigate({ to: "/", replace: true })
			: navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: current.slug } }));
	};
	const requestLeaveCustomize = useEffectEvent(() => {
		if (customize.isDirty) {
			setDiscarding(true);
			return true;
		}
		leaveCustomize();
		return true;
	});
	// The refresh must be the last load the router starts, and leaving is not synchronous: a pop
	// settles through the history listener, so invalidating on either side of the call still races
	// the navigation, which aborts whatever is in flight and leaves the sidebar rendering the order
	// the user just changed. Waiting for the router to resolve is the only ordering that holds.
	const commitCustomize = async () => {
		if (!(await customize.save())) {
			return;
		}
		const currentDraft = customize.draft.workspaces.find(({ slug }) => slug === current?.slug);
		const nextWorkspace = customize.draft.workspaces.find(({ isDisabled }) => !isDisabled);
		const unsubscribe = router.subscribe("onResolved", () => {
			unsubscribe();
			void router.invalidate();
		});
		if (currentDraft?.isDisabled !== false) {
			setDiscarding(false);
			if (nextWorkspace === undefined) {
				await navigate({ to: "/", replace: true });
				return;
			}
			await runtime.runPromise(
				Effect.flatMap(ClientStorage, (storage) =>
					storage.setLastWorkspace(scope, nextWorkspace.slug),
				),
			);
			setRememberedSlug(nextWorkspace.slug);
			await navigate({
				replace: true,
				to: "/$pluginSlug",
				params: { pluginSlug: nextWorkspace.slug },
			});
			return;
		}
		leaveCustomize();
	};
	const saveCustomize = useEffectEvent(() => void commitCustomize());
	// The edge gesture performs a kernel-owned back directly, so it has to consult the same guard
	// that `BackInterceptors` gives Android's hardware Back; otherwise one of them loses the draft.
	const goBack = useEffectEvent(() => {
		if (customizeActive) {
			requestLeaveCustomize();
			return;
		}
		router.history.back();
	});
	const customizeController = useMemo<CustomizeController>(
		() => ({ customize, onSave: saveCustomize, onLeave: requestLeaveCustomize }),
		[customize],
	);
	const header = useMemo<PluginHeaderController>(
		() => ({
			publish: (owner, publication) => setPluginHeader({ owner, ...publication }),
			clear: (owner) =>
				setPluginHeader((currentHeader) => (currentHeader?.owner === owner ? null : currentHeader)),
		}),
		[],
	);
	const shellChrome = useMemo<ShellChrome>(
		() => ({
			drawerId,
			triggerRef,
			safeAreaTop,
			onBack: goBack,
			isDrawerOpen: drawerOpen,
			onOpenDrawer: () => setDrawerOpen(true),
		}),
		[drawerId, drawerOpen, safeAreaTop],
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
		if (!customizeActive || !customize.isDirty || discarding) {
			return undefined;
		}
		return backInterceptors.register(() => {
			setDiscarding(true);
			return true;
		});
	}, [backInterceptors, customizeActive, customize.isDirty, discarding]);
	useEffect(() => {
		if (!workspaceChrome) {
			setDrawerOpen(false);
		}
	}, [workspaceChrome]);
	useDesktopEffect(() => setDrawerOpen(false));
	useShortcut("Meta+K", () => setSearchOpen(true));

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
				onEditSection={openCustomize}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onOpenSearch={() => setSearchOpen(true)}
				onNavigateSettings={() => navigate({ href: "/settings" })}
				customizePanel={
					customizeActive && isDesktop ? (
						<CustomizeSidebarPanel
							customize={customize}
							onSave={saveCustomize}
							onLeave={requestLeaveCustomize}
							initialSection={customizeSection}
						/>
					) : null
				}
			/>
			<EdgeGesture
				edge={edge}
				onBack={goBack}
				progress={progress}
				isOpen={drawerOpen}
				onOpenChange={(open) => setDrawerOpen(open)}
			/>
			<MobileDrawer
				current={current}
				catalog={catalog}
				session={session}
				sections={sections}
				progress={progress}
				isPro={props.isPro}
				drawerId={drawerId}
				isOpen={drawerOpen}
				activeKey={activeKey}
				triggerRef={triggerRef}
				activeHome={homeActive}
				hasDrawer={workspaceChrome}
				onNavigateItem={navigateItem}
				onNavigateHome={navigateHome}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onClose={() => setDrawerOpen(false)}
				onOpenSearch={() => setSearchOpen(true)}
				onCustomize={() => openCustomize("workspaces")}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			<RememberedWorkspaceContext value={rememberedSlug}>
				<CustomizeContext value={customizeController}>
					<PluginHeaderContext value={header}>
						<PluginTitleContext value={pluginTitle}>
							<EdgeContext value={edge}>
								<ShellChromeContext value={shellChrome}>
									<motion.div
										inert={drawerOpen}
										style={{ x: contentShift }}
										data-testid="shell-content"
										className="min-h-0 min-w-0 flex-1 overflow-hidden"
									>
										<Outlet />
									</motion.div>
								</ShellChromeContext>
							</EdgeContext>
						</PluginTitleContext>
					</PluginHeaderContext>
				</CustomizeContext>
			</RememberedWorkspaceContext>
			{discarding && (
				<Modal
					label="Discard sidebar changes?"
					closeLabel="Dismiss discard prompt"
					onInterceptBack={interceptDiscardBack}
					onClose={() => setDiscarding(false)}
					containerClassName="items-center justify-center p-4"
					className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-card"
				>
					<h2 className="font-display text-lg font-semibold text-text">Discard sidebar changes?</h2>
					<p className="mt-2 text-sm text-text-muted">Your unsaved sidebar changes will be lost.</p>
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setDiscarding(false)}
							className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted"
						>
							Keep editing
						</button>
						<button
							type="button"
							onClick={leaveCustomize}
							className="rounded-lg bg-danger-solid px-3 py-2 text-sm font-medium text-danger-ink"
						>
							Discard
						</button>
					</div>
				</Modal>
			)}
			{searchOpen && (
				<Modal
					label="Command center"
					closeLabel="Close command center"
					onInterceptBack={interceptSearchBack}
					onClose={() => setSearchOpen(false)}
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
