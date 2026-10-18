import { CLIENT_BRIDGE_BOOTSTRAP_READY } from "@ryot-app/plugin-client-contract";
import type {
	ClientPageContext,
	ExternalLinkOutcome,
	ExternalLinkRequest,
	KernelShortcut,
	PageShortcutKey,
	PluginAssetOutcome,
	PluginAssetRequest,
	PluginCollectionOutcome,
	PluginCollectionRequest,
	PluginUploadOutcome,
	PluginUploadRequest,
	PluginOperationOutcome,
	PluginOperationRequest,
	PluginBridgePageSearch,
	PluginBridgeProviderSearchScreen,
	ProviderSearchScreenOutcome,
	PluginRyotQLOutcome,
	PluginRyotQLRequest,
	PluginStorageOutcome,
	PluginStorageRequest,
	PluginDeviceRequest,
	PluginDeviceOutcome,
	PluginIosLiveActivityRequest,
	PluginIosLiveActivityOutcome,
} from "@ryot-app/plugin-client-contract";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { Button, ScreenFrame, StatusMessage, useShortcut } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { Effect } from "effect";
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
	type RefObject,
} from "react";

import type { WatchEntities } from "#/modules/entity-watches/service";
import { subscribeNativeResume } from "#/modules/entity-watches/transport";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import type { PluginOperationDispatchOutcome } from "#/modules/pages/bridge/operations";
import {
	openPluginBridge,
	type PluginBridgeNavigationState,
	type PluginBridgeSession,
	type PluginBridgeViewportInsets,
} from "#/modules/pages/bridge/session";
import {
	toNavigationRequest,
	type PluginNavigationRequest,
} from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import type { PageHeaderPublication, PageScreenReadiness } from "#/modules/shell/page-presentation";
import type { ThemeStore } from "#/modules/theme/store";

const PLUGIN_BACK_SETTLE_MS = 500;
const BOOTSTRAP_TIMEOUT_MS = 15_000;

type PluginHostStatus = "loading" | "handshake-failure";

const noticeMessages: Record<PluginHostStatus, string> = {
	loading: "Preparing this plugin...",
	"handshake-failure": "This plugin stopped working.",
};

const afterFlush = (
	session: PluginBridgeSession | undefined,
	act: (flushed: boolean) => void,
	signal?: AbortSignal,
) =>
	Effect.runFork(
		(session?.requestFlush() ?? Effect.succeed(true)).pipe(
			Effect.tap((flushed) => Effect.sync(() => act(flushed))),
		),
		{ signal },
	);

export function PageIframeHost(props: {
	readonly active: boolean;
	readonly title: string;
	readonly inert?: boolean;
	readonly theme: ThemeStore;
	readonly compositionHash: string;
	readonly onLoadDocument: () => Effect.Effect<string, Error>;
	readonly documentKey: string;
	readonly page?: ClientPageContext;
	readonly chromeLeading: ReactNode;
	readonly onOpenDrawer: () => void;
	readonly onNavigateBack: () => void;
	readonly onReloadCurrent: () => void;
	readonly watchEntities: WatchEntities;
	readonly freshnessCheckRevision: number;
	readonly backInterceptors: BackInterceptors;
	readonly viewport: PluginBridgeViewportInsets;
	readonly navigation: PluginBridgeNavigationState;
	readonly onOverlayState: (count: number) => void;
	readonly chromeTriggerRef: RefObject<HTMLElement | null>;
	readonly mutationCompleted: RyotClient["mutationCompleted"];
	readonly onCheckFreshness: () => Effect.Effect<boolean, Error>;
	readonly onHeader: (header: PageHeaderPublication) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly subscribeResume?: (resumed: () => void) => () => void;
	readonly onNavigate: (request: PluginNavigationRequest) => void;
	readonly onPageSearch: (request: PluginBridgePageSearch) => void;
	readonly onScreenState: (state: PageScreenReadiness | null) => void;
	readonly onProviderSearch: (
		request: PluginBridgeProviderSearchScreen,
	) => Effect.Effect<ProviderSearchScreenOutcome>;
	readonly onAssets: (request: PluginAssetRequest) => Effect.Effect<PluginAssetOutcome>;
	readonly onUpload: (request: PluginUploadRequest) => Effect.Effect<PluginUploadOutcome>;
	readonly onExternalLink: (request: ExternalLinkRequest) => Effect.Effect<ExternalLinkOutcome>;
	readonly onCollection: (
		request: PluginCollectionRequest,
	) => Effect.Effect<PluginCollectionOutcome>;
	readonly onQuery: (request: PluginRyotQLRequest) => Effect.Effect<PluginRyotQLOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
	) => Effect.Effect<PluginOperationDispatchOutcome>;
	readonly onStorage: (request: PluginStorageRequest) => Effect.Effect<PluginStorageOutcome>;
	readonly onDevice: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceOutcome>;
	readonly onIosLiveActivity: (
		request: PluginIosLiveActivityRequest,
	) => Effect.Effect<PluginIosLiveActivityOutcome>;
	readonly onFlushReady: (flush: (() => Effect.Effect<boolean>) | undefined) => void;
	readonly onReleaseResources: () => void;
}) {
	const { key, index, compact, leading, edgeBack, location } = props.navigation;
	const routePath = location.kind === "route" ? location.path : undefined;
	const entityId = location.kind === "entity" ? location.entityId : undefined;
	const routeSearch = location.kind === "route" ? location.search : undefined;
	const entitySchemaSlug = location.kind === "entity" ? location.entitySchemaSlug : undefined;
	const { subscribeResume, chromeTriggerRef } = props;
	const latest = useRef(props);
	const { catalog } = usePluginCatalog();
	const latestCatalog = useRef(catalog);
	const [srcDoc, setSrcDoc] = useState<string>();
	const frame = useRef<HTMLIFrameElement>(null);
	const backSettle = useRef<number>(undefined);
	const bridge = useRef<PluginBridgeSession>(undefined);
	const markCompositionStale = useRef<(() => void) | undefined>(undefined);
	const freshnessRevision = useRef(props.freshnessCheckRevision);
	const documentKey = useRef(props.documentKey);
	const mutationRevision = useRef(0);
	const refreshedMutationRevision = useRef(0);
	const [overlayCount, setOverlayCount] = useState(0);
	const [pageShortcuts, setPageShortcuts] = useState<readonly PageShortcutKey[]>([]);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [persistenceFailed, setPersistenceFailed] = useState(false);
	const [frameStatus, setFrameStatus] = useState<"ready" | "loading" | "handshake-failure">(
		"loading",
	);
	useLayoutEffect(() => {
		latest.current = props;
		latestCatalog.current = catalog;
	});
	const closeBridge = () => {
		latest.current.onReleaseResources();
		latest.current.onFlushReady(undefined);
		bridge.current?.close();
		bridge.current = undefined;
		latest.current.onScreenState(null);
		setOverlayCount(0);
		setPageShortcuts([]);
		latest.current.onOverlayState(0);
	};
	const retryDocument = () => {
		afterFlush(bridge.current, (flushed) => {
			setPersistenceFailed(!flushed);
			if (flushed) {
				closeBridge();
				latest.current.onReloadCurrent();
			}
		});
	};
	const failHandshake = useEffectEvent(() => {
		closeBridge();
		setFrameStatus("handshake-failure");
	});
	const releaseBridge = useEffectEvent(closeBridge);
	useEffect(() => {
		if (frameStatus !== "loading") {
			return undefined;
		}
		const timeout = window.setTimeout(() => failHandshake(), BOOTSTRAP_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [frameStatus]);
	useEffect(() => {
		const controller = new AbortController();
		Effect.runFork(
			latest.current
				.onLoadDocument()
				.pipe(
					Effect.match({
						onFailure: () => failHandshake(),
						onSuccess: (document) => setSrcDoc(document),
					}),
				),
			{ signal: controller.signal },
		);
		return () => controller.abort();
	}, []);

	useEffect(() => {
		markCompositionStale.current = () => setUpdateAvailable(true);
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible" && latest.current.active) {
				bridge.current?.sendPageRefresh();
			}
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		const releaseResume = (subscribeResume ?? subscribeNativeResume)(() => {
			if (latest.current.active) {
				bridge.current?.sendPageRefresh();
			}
		});
		return () => {
			releaseBridge();
			markCompositionStale.current = undefined;
			document.removeEventListener("visibilitychange", onVisibilityChange);
			releaseResume();
		};
	}, [subscribeResume]);

	useEffect(() => {
		if (freshnessRevision.current === props.freshnessCheckRevision) {
			return undefined;
		}
		freshnessRevision.current = props.freshnessCheckRevision;
		const checkedDocumentKey = props.documentKey;
		const controller = new AbortController();
		Effect.runFork(
			latest.current.onCheckFreshness().pipe(
				Effect.map((current) => {
					if (
						!controller.signal.aborted &&
						!current &&
						latest.current.documentKey === checkedDocumentKey
					) {
						setUpdateAvailable(true);
					}
				}),
				Effect.ignore,
			),
			{ signal: controller.signal },
		);
		return () => controller.abort();
	}, [props.freshnessCheckRevision, props.documentKey]);

	useEffect(() => {
		if (documentKey.current === props.documentKey) {
			return undefined;
		}
		const requestedKey = props.documentKey;
		const controller = new AbortController();
		afterFlush(
			bridge.current,
			(flushed) => {
				if (latest.current.documentKey !== requestedKey) {
					return;
				}
				setPersistenceFailed(!flushed);
				if (!flushed) {
					return;
				}
				documentKey.current = requestedKey;
				const current = latest.current;
				setUpdateAvailable(false);
				setOverlayCount(0);
				setPageShortcuts([]);
				current.onOverlayState(0);
				current.onScreenState(null);
				current.onHeader({
					title: null,
					key: current.navigation.key,
					index: current.navigation.index,
				});
				if (current.page) {
					current.onReleaseResources();
					bridge.current?.sendDocument(current.documentKey, current.page, current.navigation);
				}
			},
			controller.signal,
		);
		return () => controller.abort();
	}, [props.documentKey]);

	const locationKey = JSON.stringify([
		key,
		index,
		compact,
		leading,
		edgeBack,
		entityId,
		routePath,
		routeSearch,
		entitySchemaSlug,
	]);
	const [bridgeLocation, setBridgeLocation] = useState({
		key: locationKey,
		navigation: props.navigation,
	});
	if (bridgeLocation.key !== locationKey) {
		setBridgeLocation({ key: locationKey, navigation: props.navigation });
	}
	const bridgeNavigation = bridgeLocation.navigation;
	useEffect(() => {
		if (!props.active) {
			return;
		}
		window.clearTimeout(backSettle.current);
		bridge.current?.sendLocation(bridgeNavigation);
	}, [props.active, bridgeNavigation]);

	useEffect(
		() =>
			props.theme.subscribe(() => {
				bridge.current?.sendTheme(props.theme.getSnapshot());
			}),
		[props.theme],
	);

	useEffect(() => {
		if (!props.active || overlayCount === 0) {
			return undefined;
		}
		return props.backInterceptors.register(() => bridge.current?.requestOverlayDismiss() ?? false, {
			priority: "iframe",
		});
	}, [overlayCount, props.active, props.backInterceptors]);

	useEffect(() => {
		bridge.current?.sendViewport(props.viewport);
	}, [props.viewport]);

	useEffect(
		() =>
			props.mutationCompleted.subscribe(() => {
				mutationRevision.current++;
				if (latest.current.active) {
					refreshedMutationRevision.current = mutationRevision.current;
					bridge.current?.sendPageRefresh();
				}
			}),
		[props.mutationCompleted],
	);
	useEffect(() => {
		if (props.active && refreshedMutationRevision.current !== mutationRevision.current) {
			refreshedMutationRevision.current = mutationRevision.current;
			bridge.current?.sendPageRefresh();
		}
	}, [props.active]);

	function connect() {
		const plugin = frame.current?.contentWindow;
		closeBridge();
		if (!plugin) {
			setFrameStatus("handshake-failure");
			return;
		}
		setFrameStatus("loading");
		const connection: { failed: boolean; session?: PluginBridgeSession } = { failed: false };
		const nextBridge = openPluginBridge({
			target: plugin,
			page: latest.current.page,
			viewport: latest.current.viewport,
			navigation: latest.current.navigation,
			compositionHash: props.compositionHash,
			onReady: () => setFrameStatus("ready"),
			documentKey: latest.current.documentKey,
			theme: latest.current.theme.getSnapshot(),
			onOpenDrawer: () => latest.current.onOpenDrawer(),
			onRyotQL: (request) => latest.current.onQuery(request),
			onAssets: (request) => latest.current.onAssets(request),
			onUpload: (request) => latest.current.onUpload(request),
			onDevice: (request) => latest.current.onDevice(request),
			onStorage: (request) => latest.current.onStorage(request),
			onPageSearch: (request) => latest.current.onPageSearch(request),
			onCollection: (request) => latest.current.onCollection(request),
			onExternalLink: (request) => latest.current.onExternalLink(request),
			onProviderSearch: (request) => latest.current.onProviderSearch(request),
			onIosLiveActivity: (request) => latest.current.onIosLiveActivity(request),
			onKernelShortcut: (shortcut) => latest.current.onKernelShortcut(shortcut),
			watchEntities: (interest, onUpdate) => latest.current.watchEntities(interest, onUpdate),
			onFailure: () => {
				connection.failed = true;
				closeBridge();
				setFrameStatus("handshake-failure");
			},
			onPageShortcuts: (shortcuts) => {
				if (bridge.current === connection.session) {
					setPageShortcuts(shortcuts);
				}
			},
			onScreenState: (state) => {
				if (bridge.current === connection.session) {
					latest.current.onScreenState(state);
				}
			},
			onOverlayState: (count) => {
				if (bridge.current === connection.session) {
					setOverlayCount(count);
					latest.current.onOverlayState(count);
				}
			},
			onNavigate: (request) => {
				const navigation = toNavigationRequest(request, latestCatalog.current);
				if (navigation !== undefined) {
					latest.current.onNavigate(navigation);
				}
			},
			onNavigateBack: () => {
				latest.current.onNavigateBack();
				window.clearTimeout(backSettle.current);
				backSettle.current = window.setTimeout(
					() => bridge.current?.sendLocation(latest.current.navigation),
					PLUGIN_BACK_SETTLE_MS,
				);
			},
			onHeader: (request) => {
				const current = latest.current.navigation;
				if (request.index === current.index && request.key === current.key) {
					latest.current.onHeader({
						key: request.key,
						index: request.index,
						title: request.header?.title ?? null,
					});
				}
			},
			onOperation: (request) =>
				latest.current.onInvokeOperation(request).pipe(
					Effect.map((outcome): PluginOperationOutcome => {
						if (outcome.outcome !== "stale-session") {
							return outcome;
						}
						if (bridge.current === connection.session) {
							markCompositionStale.current?.();
						}
						return { outcome: "failure", reason: "operation-failed" };
					}),
				),
		});
		if (!connection.failed) {
			connection.session = nextBridge;
			bridge.current = nextBridge;
			latest.current.onFlushReady(nextBridge.requestFlush);
		}
	}
	useEffect(() => {
		const onBootstrapReady = (event: MessageEvent) => {
			if (
				event.source === frame.current?.contentWindow &&
				event.data?.type === CLIENT_BRIDGE_BOOTSTRAP_READY
			) {
				connect();
			}
		};
		window.addEventListener("message", onBootstrapReady);
		return () => window.removeEventListener("message", onBootstrapReady);
	});

	const chrome = { compact, leading: props.chromeLeading, safeAreaTop: props.viewport.safeAreaTop };
	if (frameStatus === "handshake-failure") {
		return <PluginNotice {...chrome} status={frameStatus} onRetry={retryDocument} />;
	}

	return (
		<div className="relative h-full w-full">
			{persistenceFailed && (
				<div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-2 bg-surface px-4 py-2 text-sm">
					<StatusMessage tone="error">Your changes could not be saved.</StatusMessage>
					<Button type="button" variant="secondary" onClick={retryDocument}>
						Retry
					</Button>
				</div>
			)}
			{frameStatus === "ready" &&
				props.active &&
				props.inert !== true &&
				!updateAvailable &&
				pageShortcuts.map((shortcut) => (
					<PageShortcut
						key={shortcut}
						shortcut={shortcut}
						onPress={() => bridge.current?.sendShortcut(shortcut)}
					/>
				))}
			{srcDoc === undefined ? null : (
				<iframe
					srcDoc={srcDoc}
					sandbox="allow-scripts"
					title={`${props.title} plugin`}
					inert={props.inert === true || updateAvailable}
					className={clsx("h-full w-full border-0", frameStatus !== "ready" && "invisible")}
					ref={(node) => {
						frame.current = node;
						if (props.active) {
							chromeTriggerRef.current = node;
						}
					}}
				/>
			)}
			{frameStatus === "ready" ? null : (
				<div className="absolute inset-0">
					<PluginChromeFrame
						compact={compact}
						title="Loading plugin"
						leading={props.chromeLeading}
						safeAreaTop={props.viewport.safeAreaTop}
					>
						<PluginNoticePanel status="loading" />
					</PluginChromeFrame>
				</div>
			)}
			{updateAvailable ? (
				<div className="absolute inset-0">
					<PluginChromeFrame
						compact={compact}
						title="Update available"
						leading={props.chromeLeading}
						safeAreaTop={props.viewport.safeAreaTop}
					>
						<section className="ui-stack ui-card mx-auto w-[min(100%,480px)]">
							<p role="alert" className="text-text-muted">
								An update is available. Reloading will discard unsaved local state.
							</p>
							<Button type="button" onClick={props.onReloadCurrent}>
								Reload updated page
							</Button>
						</section>
					</PluginChromeFrame>
				</div>
			) : null}
		</div>
	);
}

function PageShortcut(props: { readonly shortcut: PageShortcutKey; readonly onPress: () => void }) {
	const press = useRef(props.onPress);
	useLayoutEffect(() => {
		press.current = props.onPress;
	});
	useShortcut(props.shortcut, () => press.current());
	return null;
}

function PluginChromeFrame(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly leading: ReactNode;
	readonly safeAreaTop: number;
	readonly children: ReactNode;
}) {
	const scrollRootRef = useRef<HTMLDivElement>(null);

	return (
		<div
			ref={scrollRootRef}
			className="h-full overflow-y-auto bg-bg pb-[max(32px,env(safe-area-inset-bottom))]"
		>
			<ScreenFrame
				title={props.title}
				compact={props.compact}
				leading={props.leading}
				scrollRootRef={scrollRootRef}
				safeAreaTop={props.safeAreaTop}
			>
				{props.children}
			</ScreenFrame>
		</div>
	);
}

function PluginNotice(props: {
	readonly compact: boolean;
	readonly leading: ReactNode;
	readonly safeAreaTop: number;
	readonly onRetry?: () => void;
	readonly status: PluginHostStatus;
}) {
	return (
		<div className="h-full">
			<PluginChromeFrame
				compact={props.compact}
				leading={props.leading}
				safeAreaTop={props.safeAreaTop}
				title={props.status === "loading" ? "Loading plugin" : "Plugin unavailable"}
			>
				<PluginNoticePanel status={props.status} onRetry={props.onRetry} />
			</PluginChromeFrame>
		</div>
	);
}

function PluginNoticePanel(props: {
	readonly onRetry?: () => void;
	readonly status: PluginHostStatus;
}) {
	return (
		<section className="ui-stack ui-card mx-auto w-[min(100%,480px)]">
			<p className="text-text-muted" role={props.status === "loading" ? "status" : "alert"}>
				{noticeMessages[props.status]}
			</p>
			{props.onRetry ? (
				<Button type="button" onClick={props.onRetry}>
					Retry
				</Button>
			) : null}
		</section>
	);
}
