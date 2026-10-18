import { pluginPath, savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import {
	type PluginId,
	pluginPackageIdFromSegments,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import { KERNEL_SHORTCUTS, type KernelShortcut } from "@ryot-app/plugin-client-contract";
import { Button, Modal, useShortcut, useValueChange } from "@ryot-app/plugin-ui-sdk";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import {
	Outlet,
	useMatch,
	useNavigate,
	useRouteContext,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useAuthenticatedSession } from "#/modules/auth/session-boundary";
import { BackgroundSubmissionTrayView } from "#/modules/background-submissions/tray";
import { CollectionEditor } from "#/modules/collections/collection-editor";
import { CommandCenter } from "#/modules/command-center/command-center";
import { useIsDemoSession } from "#/modules/demo-protection";
import { impactHaptic } from "#/modules/device/haptics";
import { DeviceScope, ReturnShortcutBar } from "#/modules/device/lifecycle";
import { IosLiveActivityScope } from "#/modules/ios-live-activities/lifecycle";
import { CONTENT_SHIFT } from "#/modules/navigation/drawer-metrics";
import { EdgeGesture } from "#/modules/navigation/edge-gesture";
import {
	hasWorkspaceChrome,
	isCustomizeSidebarPath,
	isSettingsPath,
	resolveEdge,
} from "#/modules/navigation/edge-intent";
import { historyEntry } from "#/modules/navigation/history-entry";
import {
	isWorkspaceRoot,
	preparedPageInstallationId,
	resolveRememberedWorkspace,
	type WorkspaceTarget,
} from "#/modules/navigation/workspace-state";
import { ClientPageDocumentProvider } from "#/modules/pages/documents/state";
import { ClientPageDocumentHost } from "#/modules/pages/runtime/document-host";
import { effectiveCatalogPlugin, toNavigationRequest } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import {
	ClientPagePresentationContext,
	createClientPagePresentationController,
	CustomizeContext,
	type CustomizeController,
	EdgeContext,
	emptyClientPagePresentation,
	matchesEntry,
	PluginTitleContext,
	RememberedWorkspaceContext,
	type ShellChrome,
	ShellChromeContext,
} from "#/modules/shell/authenticated-shell-context";
import { useDesktopEffect, useIsDesktop } from "#/modules/shell/breakpoint";
import { CustomizeSidebarPanel } from "#/modules/shell/customize/customize-sidebar-panel";
import {
	customizeSearchSection,
	type CustomizeSection,
} from "#/modules/shell/customize/customize-state";
import { useCustomizeDraft } from "#/modules/shell/customize/use-customize-draft";
import { DesktopSidebar } from "#/modules/shell/desktop-sidebar";
import { MobileDrawer } from "#/modules/shell/mobile-drawer";
import { useSafeAreaInsets } from "#/modules/shell/safe-area";
import {
	navigationViewHref,
	type SidebarEntry,
	sidebarSections,
} from "#/modules/shell/sidebar-sections";
import { useSidebarExpansion } from "#/modules/shell/use-sidebar-expansion";
import { useStableHandler } from "#/modules/ui/use-stable-handler";
import { ClientStorage } from "#/persistence/storage";

export function AuthenticatedShell(props: {
	readonly isPro: boolean;
	readonly navigation: NavigationData;
	readonly initialRememberedPluginId: null | PluginId;
}) {
	const drawerId = useId();
	const router = useRouter();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const safeAreaInsets = useSafeAreaInsets();
	const { catalog } = usePluginCatalog();
	const progress = useMotionValue(0);
	const { state, search, pathname, searchStr } = useRouterState({
		select: (routerState) => routerState.resolvedLocation ?? routerState.location,
	});
	const contentShift = useTransform(progress, [0, 1], [0, CONTENT_SHIFT]);
	const triggerRef = useRef<HTMLElement>(null);
	const { scope, server, runtime, backInterceptors } = useRouteContext({ from: "/_authenticated" });
	const navigateDeviceTarget = (target: Parameters<typeof toNavigationRequest>[0]["target"]) => {
		const request = toNavigationRequest({ target, mode: "push", type: "navigate" }, catalog);
		if (request) {
			void navigate({ href: request.href });
		}
	};
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [creatingCollection, setCreatingCollection] = useState(false);
	const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
	const [presentationState, setPresentationState] = useState(emptyClientPagePresentation);
	const [discarding, setDiscarding] = useState(false);
	const [rememberedPluginId, setRememberedPluginId] = useState(props.initialRememberedPluginId);
	const settingsActive = isSettingsPath(pathname);
	const customizeActive = isCustomizeSidebarPath(pathname);
	const customizeSection = customizeSearchSection(search);
	const workspaceChrome = hasWorkspaceChrome(pathname);
	const committedPathname = pathname;
	const routePackageId = useMatch({
		shouldThrow: false,
		from: "/_authenticated/p/$publisher/$name",
		select: ({ params }) => pluginPackageIdFromSegments(params),
	});
	const routeWorkspace =
		routePackageId === undefined ? null : (effectiveCatalogPlugin(catalog, routePackageId) ?? null);
	const activeKey = useActiveSidebarKey();
	const routeView = props.navigation.savedViews.find(
		(view) => `view:${navigationViewHref(view)}` === activeKey,
	);
	const viewWorkspace = routeView?.pluginInstallationId
		? catalog.find(({ installationId }) => installationId === routeView.pluginInstallationId)
		: undefined;
	const entityInstallationId = useMatch({
		shouldThrow: false,
		from: "/_authenticated/e/$entityId",
		select: ({ loaderData }) =>
			loaderData?.preparation.kind === "ready"
				? preparedPageInstallationId(loaderData.preparation.prepared)
				: undefined,
	});
	const entityWorkspace =
		entityInstallationId === undefined
			? undefined
			: catalog.find(({ installationId }) => installationId === entityInstallationId);
	const current =
		routeWorkspace ??
		viewWorkspace ??
		entityWorkspace ??
		resolveRememberedWorkspace(catalog, rememberedPluginId);
	const homeActive = isWorkspaceRoot(pathname, current);
	const sidebarExpansion = useSidebarExpansion({
		scope,
		runtime,
		workspace: current?.installationId ?? "none",
	});
	const sections = useMemo(
		() =>
			sidebarSections({ data: props.navigation, workspaceInstallationId: current?.installationId }),
		[current?.installationId, props.navigation],
	);
	const entry = historyEntry(state);
	const [presentation] = useState(() =>
		createClientPagePresentationController(setPresentationState),
	);
	const {
		header: pluginHeader,
		readiness: pluginScreenState,
		overlayCount: pluginOverlayCount,
	} = presentationState;
	useValueChange(workspaceChrome, (chrome) => {
		if (!chrome) {
			setDrawerOpen(false);
		}
	});
	const pluginTitle =
		pluginHeader !== null && matchesEntry(pluginHeader, entry) ? pluginHeader.title : null;
	const { session, stopError, stopPending, authSnapshot, impersonation, stopImpersonation } =
		useAuthenticatedSession(runtime, server);
	const isDemo = useIsDemoSession(session);
	const selectWorkspace = ({ pluginId, packageId }: WorkspaceTarget) => {
		Effect.runFork(impactHaptic);
		return runtime.runPromise(
			Effect.gen(function* () {
				yield* Effect.flatMap(ClientStorage, (storage) =>
					storage.setLastWorkspace(scope, pluginId),
				);
				setRememberedPluginId(pluginId);
				yield* Effect.promise(() => navigate({ replace: true, href: pluginPath(packageId) }));
			}),
		);
	};
	const navigateHome = () =>
		current === null ? undefined : navigate({ href: pluginPath(current.packageId) });
	const navigateItem = (item: SidebarEntry) =>
		item.kind === "collection"
			? navigate({ to: "/e/$entityId", params: { entityId: item.slug } })
			: navigate({
					href: navigationViewHref(item),
					replace: activeKey?.startsWith("view:") === true,
				});
	const interceptSearchBack = () => {
		setSearchOpen(false);
		return true;
	};
	const interceptDiscardBack = () => {
		setDiscarding(false);
		return true;
	};
	const onKernelShortcut = useCallback(
		(shortcut: KernelShortcut) => {
			if (shortcut === "command-center") {
				setSearchOpen(true);
				return;
			}
			if (isDesktop) {
				setWorkspaceSwitcherOpen(true);
			}
		},
		[isDesktop],
	);
	const customize = useCustomizeDraft({
		catalog,
		data: props.navigation,
		active: customizeActive,
		workspaceInstallationId: current?.installationId,
	});
	const openCustomize = (section: CustomizeSection) => {
		void navigate({ search: { section }, to: "/customize-sidebar" });
	};
	const leaveCustomize = () => {
		setDiscarding(false);
		if (router.history.canGoBack()) {
			router.history.back();
			return;
		}
		void (current === null
			? navigate({ to: "/", replace: true })
			: navigate({ replace: true, href: pluginPath(current.packageId) }));
	};
	const requestLeaveCustomize = useStableHandler(() => {
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
	const commitCustomize = () =>
		runtime.runPromise(
			Effect.gen(function* () {
				if (!(yield* customize.save())) {
					return;
				}
				const currentDraft = customize.draft.workspaces.find(
					({ pluginId }) => pluginId === current?.pluginId,
				);
				const nextWorkspace = customize.draft.workspaces.find(({ isHidden }) => !isHidden);
				const unsubscribe = router.subscribe("onResolved", () => {
					unsubscribe();
					void router.invalidate();
				});
				if (currentDraft?.isHidden !== false) {
					setDiscarding(false);
					if (nextWorkspace === undefined) {
						yield* Effect.promise(() => navigate({ to: "/", replace: true }));
						return;
					}
					yield* Effect.flatMap(ClientStorage, (storage) =>
						storage.setLastWorkspace(scope, nextWorkspace.pluginId),
					);
					setRememberedPluginId(nextWorkspace.pluginId);
					yield* Effect.promise(() =>
						navigate({ replace: true, href: pluginPath(nextWorkspace.packageId) }),
					);
					return;
				}
				leaveCustomize();
			}),
		);
	const saveCustomize = useStableHandler(() => void commitCustomize());
	const goBack = useStableHandler(() => {
		if (backInterceptors.run()) {
			return;
		}
		if (customizeActive) {
			requestLeaveCustomize();
			return;
		}
		router.history.back();
	});
	const customizeController = useMemo<CustomizeController>(
		() => ({ customize, readOnly: isDemo, onSave: saveCustomize, onLeave: requestLeaveCustomize }),
		[customize, isDemo, requestLeaveCustomize, saveCustomize],
	);
	const shellChrome = useMemo<ShellChrome>(
		() => ({
			drawerId,
			triggerRef,
			onBack: goBack,
			...safeAreaInsets,
			onKernelShortcut,
			isDrawerOpen: drawerOpen,
			onOpenDrawer: () => setDrawerOpen(true),
		}),
		[drawerId, drawerOpen, goBack, onKernelShortcut, safeAreaInsets],
	);
	const hasPluginBackScreen =
		pluginScreenState !== null &&
		matchesEntry(pluginScreenState, entry) &&
		pluginScreenState.hasPreviousScreen;

	const edge = resolveEdge({
		isDesktop,
		hasPluginBackScreen,
		pathname: committedPathname,
		canGoBack: router.history.canGoBack(),
		hasIframeOverlay: pluginOverlayCount > 0,
		atRoot: isWorkspaceRoot(committedPathname, routeWorkspace),
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
		return backInterceptors.register(() => {
			setSearchOpen(false);
			return true;
		});
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
	useDesktopEffect(() => setDrawerOpen(false));
	useShortcut(KERNEL_SHORTCUTS.commandCenter, () => setSearchOpen(true));

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
				shortcutsEnabled={isDesktop}
				navigation={props.navigation}
				onNavigateHome={navigateHome}
				onNavigateItem={navigateItem}
				onEditSection={openCustomize}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onOpenSearch={() => setSearchOpen(true)}
				onToggleSection={sidebarExpansion.toggle}
				expandedSections={sidebarExpansion.expanded}
				workspaceSwitcherOpen={workspaceSwitcherOpen}
				onCreateCollection={() => setCreatingCollection(true)}
				onWorkspaceSwitcherOpenChange={setWorkspaceSwitcherOpen}
				onNavigateSettings={() => navigate({ href: "/settings" })}
				customizePanel={
					customizeActive && isDesktop ? (
						<CustomizeSidebarPanel
							readOnly={isDemo}
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
				navigation={props.navigation}
				onNavigateItem={navigateItem}
				onNavigateHome={navigateHome}
				activeSettings={settingsActive}
				onSelectWorkspace={selectWorkspace}
				onClose={() => setDrawerOpen(false)}
				onOpenSearch={() => setSearchOpen(true)}
				onToggleSection={sidebarExpansion.toggle}
				expandedSections={sidebarExpansion.expanded}
				onCustomize={() => openCustomize("workspaces")}
				onCreateCollection={() => setCreatingCollection(true)}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			<RememberedWorkspaceContext value={rememberedPluginId}>
				<DeviceScope scope={scope} runtime={runtime} onNavigate={navigateDeviceTarget} />
				<IosLiveActivityScope scope={scope} runtime={runtime} catalog={catalog} />
				<CustomizeContext value={customizeController}>
					<ClientPagePresentationContext value={presentation}>
						<PluginTitleContext value={pluginTitle}>
							<EdgeContext value={edge}>
								<ShellChromeContext value={shellChrome}>
									<motion.div
										inert={drawerOpen}
										style={{ x: contentShift }}
										data-testid="shell-content"
										className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
									>
										{impersonation && authSnapshot.status === "authenticated" && (
											<ImpersonationBanner
												error={stopError}
												pending={stopPending}
												user={authSnapshot.user}
												onStop={stopImpersonation}
												expiresAt={impersonation.expiresAt}
											/>
										)}
										<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
											<ClientPageDocumentProvider>
												<ClientPageDocumentHost />
												<Outlet />
											</ClientPageDocumentProvider>
										</div>
										<ReturnShortcutBar
											scope={scope}
											runtime={runtime}
											onNavigate={navigateDeviceTarget}
											safeAreaBottom={safeAreaInsets.safeAreaBottom}
											isCurrent={(target) =>
												toNavigationRequest({ target, mode: "push", type: "navigate" }, catalog)
													?.href === `${pathname}${searchStr}`
											}
										/>
									</motion.div>
								</ShellChromeContext>
							</EdgeContext>
						</PluginTitleContext>
					</ClientPagePresentationContext>
				</CustomizeContext>
			</RememberedWorkspaceContext>
			<BackgroundSubmissionTrayView
				catalog={catalog}
				compact={!isDesktop}
				onReload={() => window.location.reload()}
				safeAreaBottom={safeAreaInsets.safeAreaBottom}
			/>
			{discarding && (
				<Modal
					label="Discard sidebar changes?"
					closeLabel="Dismiss discard prompt"
					onClose={() => setDiscarding(false)}
					onInterceptBack={interceptDiscardBack}
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
			{creatingCollection && (
				<CollectionEditor
					onClose={() => setCreatingCollection(false)}
					onDeleted={() => setCreatingCollection(false)}
					onSaved={(collectionId) => {
						setCreatingCollection(false);
						void navigate({ href: `/e/${encodeURIComponent(collectionId)}` });
					}}
				/>
			)}
			{searchOpen && (
				<CommandCenter
					scope={scope}
					catalog={catalog}
					runtime={runtime}
					navigation={props.navigation}
					onClose={() => setSearchOpen(false)}
					onInterceptBack={interceptSearchBack}
					onNavigate={(href) => void navigate({ href })}
				/>
			)}
		</div>
	);
}

function ImpersonationBanner(props: {
	readonly pending: boolean;
	readonly expiresAt: number;
	readonly onStop: () => void;
	readonly error: string | undefined;
	readonly user: { readonly name: string; readonly email: string };
}) {
	const expiration = new Intl.DateTimeFormat(undefined, {
		timeStyle: "short",
		dateStyle: "medium",
	}).format(new Date(props.expiresAt));
	return (
		<aside
			role="status"
			data-testid="impersonation-banner"
			className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm text-text"
		>
			<p>
				Impersonating <strong>{props.user.name}</strong> ({props.user.email}) until {expiration}.
			</p>
			{props.error && <p role="alert">{props.error}</p>}
			<Button type="button" variant="secondary" onClick={props.onStop} disabled={props.pending}>
				{props.pending ? "Stopping..." : "Stop impersonating"}
			</Button>
		</aside>
	);
}

function useActiveSidebarKey() {
	const customViewPath = useMatch({
		shouldThrow: false,
		from: "/_authenticated/v/c/$savedViewId",
		select: ({ params }) =>
			savedViewPath({ kind: "custom", savedViewId: SavedViewId.make(params.savedViewId) }),
	});
	const kernelViewPath = useMatch({
		shouldThrow: false,
		from: "/_authenticated/v/k/$slug",
		select: ({ params }) => savedViewPath({ kind: "kernel", slug: params.slug }),
	});
	const pluginViewPath = useMatch({
		shouldThrow: false,
		from: "/_authenticated/v/p/$publisher/$name/$slug",
		select: ({ params }) =>
			savedViewPath({
				kind: "plugin",
				slug: params.slug,
				packageId: pluginPackageIdFromSegments(params),
			}),
	});
	const collectionSlug = useMatch({
		shouldThrow: false,
		from: "/_authenticated/e/$entityId",
		select: ({ params }) => params.entityId,
	});
	const viewPath = customViewPath ?? kernelViewPath ?? pluginViewPath;
	if (viewPath !== undefined) {
		return `view:${viewPath}`;
	}
	return collectionSlug === undefined ? null : `collection:${collectionSlug}`;
}
