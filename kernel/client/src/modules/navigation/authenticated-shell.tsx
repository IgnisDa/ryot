import { KERNEL_SHORTCUTS, type KernelShortcut } from "@ryot-app/client-plugin-contract";
import { Button, Modal, useShortcut, useValueChange } from "@ryot-app/client-ui-sdk";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import {
	Outlet,
	useNavigate,
	useRouteContext,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { Effect } from "effect";
import { motion, useMotionValue, useTransform } from "motion/react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import {
	awaitDocumentVisible,
	waitForImpersonationExpiry,
} from "#/modules/auth/impersonation-expiry";
import { oauthTokenKey } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { subscribeOAuthSessionBoundary } from "#/modules/auth/token-identity";
import { ClientPageDocumentProvider } from "#/modules/client-pages/document";
import { ClientPageDocumentHost } from "#/modules/client-pages/page-host";
import { useIsDemoSession } from "#/modules/demo-protection";
import {
	CustomizeContext,
	ClientPageOverlayContext,
	ClientPageScreenContext,
	EdgeContext,
	PluginHeaderContext,
	PluginTitleContext,
	RememberedWorkspaceContext,
	ShellChromeContext,
	type CustomizeController,
	type ClientPageScreenState,
	type PluginHeaderState,
	createClientDocumentControllers,
	type ShellChrome,
} from "#/modules/navigation/authenticated-shell-context";
import { useDesktopEffect, useIsDesktop } from "#/modules/navigation/breakpoint";
import { CustomizeSidebarPanel } from "#/modules/navigation/customize/customize-sidebar-panel";
import {
	customizeSearchSection,
	type CustomizeSection,
} from "#/modules/navigation/customize/customize-state";
import { useCustomizeDraft } from "#/modules/navigation/customize/use-customize-draft";
import { DesktopSidebar } from "#/modules/navigation/desktop-sidebar";
import { CONTENT_SHIFT } from "#/modules/navigation/drawer-metrics";
import { EdgeGesture } from "#/modules/navigation/edge-gesture";
import {
	hasWorkspaceChrome,
	isCustomizeSidebarPath,
	isSettingsPath,
	resolveEdge,
} from "#/modules/navigation/edge-intent";
import { impactLight } from "#/modules/navigation/haptics";
import { historyEntry } from "#/modules/navigation/history-entry";
import { MobileDrawer } from "#/modules/navigation/mobile-drawer";
import { useSafeAreaInsets } from "#/modules/navigation/safe-area";
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
import { useStableHandler } from "#/modules/ui/use-stable-handler";
import { ClientStorage } from "#/persistence/storage";

export function AuthenticatedShell(props: {
	readonly isPro: boolean;
	readonly navigation: NavigationData;
	readonly initialRememberedSlug: string | null;
}) {
	const drawerId = useId();
	const router = useRouter();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const safeAreaInsets = useSafeAreaInsets();
	const { catalog } = usePluginCatalog();
	const progress = useMotionValue(0);
	const { state, search, pathname } = useRouterState({
		select: (routerState) => routerState.resolvedLocation ?? routerState.location,
	});
	const contentShift = useTransform(progress, [0, 1], [0, CONTENT_SHIFT]);
	const triggerRef = useRef<HTMLElement>(null);
	const { scope, server, runtime, backInterceptors } = useRouteContext({ from: "/_authenticated" });
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
	const [pluginHeader, setPluginHeader] = useState<PluginHeaderState | null>(null);
	const [pluginScreenState, setPluginScreenState] = useState<ClientPageScreenState | null>(null);
	const [pluginOverlayCount, setPluginOverlayCount] = useState(0);
	const [discarding, setDiscarding] = useState(false);
	const [rememberedSlug, setRememberedSlug] = useState(props.initialRememberedSlug);
	const settingsActive = isSettingsPath(pathname);
	const customizeActive = isCustomizeSidebarPath(pathname);
	const customizeSection = customizeSearchSection(search);
	const workspaceChrome = hasWorkspaceChrome(pathname);
	const committedPathname = pathname;
	const routeSlug = committedPathname.split("/")[1] ?? "";
	const routeWorkspace = resolvePluginRouteWorkspace(catalog, routeSlug);
	const current = routeWorkspace ?? resolveRememberedWorkspace(catalog, rememberedSlug);
	const homeActive = isWorkspaceRoot(pathname, current);
	const activeKey = useMemo(() => activeSidebarKey(pathname), [pathname]);
	const sections = useMemo(
		() => sidebarSections({ data: props.navigation, workspaceSlug: current?.slug }),
		[current?.slug, props.navigation],
	);
	const entry = historyEntry(state);
	useValueChange(workspaceChrome, (chrome) => {
		if (!chrome) {
			setDrawerOpen(false);
		}
	});
	const [documentEntry, setDocumentEntry] = useState(entry);
	if (documentEntry.index !== entry.index || documentEntry.key !== entry.key) {
		setDocumentEntry(entry);
		setPluginScreenState(null);
		setPluginHeader((currentHeader) =>
			currentHeader !== null &&
			currentHeader.index === entry.index &&
			currentHeader.key === entry.key
				? currentHeader
				: null,
		);
	}
	const pluginTitle =
		pluginHeader !== null && pluginHeader.index === entry.index && pluginHeader.key === entry.key
			? pluginHeader.title
			: null;
	const auth = runtime.runSync(AuthService);
	const session = auth.session(server);
	const authSnapshot = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	const impersonation =
		authSnapshot.status === "authenticated" ? authSnapshot.impersonation : undefined;
	const isDemo = useIsDemoSession(session);
	const [stopPending, setStopPending] = useState(false);
	const [stopError, setStopError] = useState<string>();
	const stopImpersonation = () => {
		setStopPending(true);
		setStopError(undefined);
		runtime.runFork(
			auth.signOut(server).pipe(
				Effect.matchCause({
					onFailure: () => {
						setStopPending(false);
						setStopError("Could not stop impersonation. Please try again.");
					},
					onSuccess: (launched) => {
						setStopPending(false);
						if (!launched) {
							setStopError("Could not open the server logout page. Please try again.");
						}
					},
				}),
			),
		);
	};
	useEffect(() => {
		if (runtime.runSync(RuntimeOAuthClientService).isNative) {
			return undefined;
		}
		return subscribeOAuthSessionBoundary(window, oauthTokenKey(server), () =>
			window.location.reload(),
		);
	}, [runtime, server]);
	useEffect(() => {
		if (impersonation === undefined) {
			return undefined;
		}
		const controller = new AbortController();
		runtime.runFork(
			waitForImpersonationExpiry(impersonation.expiresAt, awaitDocumentVisible).pipe(
				Effect.andThen(auth.clearSession(server)),
				Effect.andThen(Effect.sync(() => window.location.replace("/god-mode/users"))),
			),
			{ signal: controller.signal },
		);
		return () => controller.abort();
	}, [auth, impersonation, runtime, server]);
	const selectWorkspace = (slug: string) => {
		impactLight();
		return runtime.runPromise(
			Effect.gen(function* () {
				yield* Effect.flatMap(ClientStorage, (storage) => storage.setLastWorkspace(scope, slug));
				setRememberedSlug(slug);
				yield* Effect.promise(() =>
					navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: slug } }),
				);
			}),
		);
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
			replace: activeKey?.startsWith("view:") === true,
			search: {
				q: undefined,
				add: undefined,
				sort: undefined,
				layout: undefined,
				search: undefined,
				dialog: undefined,
				entityId: undefined,
			},
		});
	};
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
		workspaceSlug: current?.slug,
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
			: navigate({ replace: true, to: "/$pluginSlug", params: { pluginSlug: current.slug } }));
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
				const currentDraft = customize.draft.workspaces.find(({ slug }) => slug === current?.slug);
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
						storage.setLastWorkspace(scope, nextWorkspace.slug),
					);
					setRememberedSlug(nextWorkspace.slug);
					yield* Effect.promise(() =>
						navigate({
							replace: true,
							to: "/$pluginSlug",
							params: { pluginSlug: nextWorkspace.slug },
						}),
					);
					return;
				}
				leaveCustomize();
			}),
		);
	const saveCustomize = useStableHandler(() => void commitCustomize());
	// The edge gesture performs a kernel-owned back directly, so it has to consult the same guard
	// that `BackInterceptors` gives Android's hardware Back; otherwise one of them loses the draft.
	const goBack = useStableHandler(() => {
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
	const [{ header, screen: pageScreen, overlay: pageOverlay }] = useState(() =>
		createClientDocumentControllers(
			{ current: null },
			setPluginHeader,
			setPluginScreenState,
			setPluginOverlayCount,
		),
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
		pluginScreenState?.index === entry.index &&
		pluginScreenState.key === entry.key &&
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
				workspaceSwitcherOpen={workspaceSwitcherOpen}
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
				onCustomize={() => openCustomize("workspaces")}
				onNavigateSettings={() => navigate({ href: "/settings" })}
			/>
			<RememberedWorkspaceContext value={rememberedSlug}>
				<CustomizeContext value={customizeController}>
					<PluginHeaderContext value={header}>
						<PluginTitleContext value={pluginTitle}>
							<EdgeContext value={edge}>
								<ShellChromeContext value={shellChrome}>
									<ClientPageScreenContext value={pageScreen}>
										<ClientPageOverlayContext value={pageOverlay}>
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
											</motion.div>
										</ClientPageOverlayContext>
									</ClientPageScreenContext>
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

function ImpersonationBanner(props: {
	readonly user: { readonly name: string; readonly email: string };
	readonly expiresAt: number;
	readonly onStop: () => void;
	readonly pending: boolean;
	readonly error: string | undefined;
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
