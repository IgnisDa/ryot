import type {
	ClientPageContext,
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
	PluginRyotQLOutcome,
	PluginRyotQLRequest,
} from "@ryot-app/client-plugin-contract";
import type { RyotClient } from "@ryot-app/client-sdk";
import { Button, ScreenFrame, useShortcut } from "@ryot-app/client-ui-sdk";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { WatchEntities } from "#/modules/entity-interest/service";
import { subscribeNativeResume } from "#/modules/entity-interest/transport";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import {
	openPluginBridge,
	type PluginBridgeNavigationState,
	type PluginBridgeSession,
	type PluginBridgeViewportInsets,
	type PluginScreenReadiness,
} from "#/modules/plugins/bridge";
import type { PluginOperationDispatchOutcome } from "#/modules/plugins/operations";
import {
	toNavigationRequest,
	type PluginNavigationRequest,
} from "#/modules/plugins/plugin-location";
import type { ThemeStore } from "#/modules/theme/store";

const PLUGIN_BACK_SETTLE_MS = 500;

export type PluginHeaderPublication = {
	readonly index: number;
	readonly key: string;
	readonly title: string | null;
};

type PluginHostStatus = "loading" | "handshake-failure";

const noticeMessages: Record<PluginHostStatus, string> = {
	loading: "Preparing this plugin...",
	"handshake-failure": "This plugin stopped working.",
};

export function PluginFrame(props: {
	readonly active: boolean;
	readonly title: string;
	readonly inert?: boolean;
	readonly theme: ThemeStore;
	readonly artifactHash: string;
	readonly artifactGrant: PreparedClientPage["artifact"]["grant"];
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
	readonly onCheckFreshness: (signal: AbortSignal) => Promise<boolean>;
	readonly onHeader: (header: PluginHeaderPublication) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly subscribeResume?: (resumed: () => void) => () => void;
	readonly onNavigate: (request: PluginNavigationRequest) => void;
	readonly onPageSearch: (request: PluginBridgePageSearch) => void;
	readonly onScreenState: (state: PluginScreenReadiness | null) => void;
	readonly onProviderSearch: (request: PluginBridgeProviderSearchScreen) => void;
	readonly onAssets: (
		request: PluginAssetRequest,
		signal: AbortSignal,
	) => Promise<PluginAssetOutcome>;
	readonly onUpload: (
		request: PluginUploadRequest,
		signal: AbortSignal,
	) => Promise<PluginUploadOutcome>;
	readonly onCollection: (
		request: PluginCollectionRequest,
		signal: AbortSignal,
	) => Promise<PluginCollectionOutcome>;
	readonly onQuery: (
		request: PluginRyotQLRequest,
		signal: AbortSignal,
	) => Promise<PluginRyotQLOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
		signal: AbortSignal,
	) => Promise<PluginOperationDispatchOutcome>;
}) {
	const { key, index, compact, leading, edgeBack, location } = props.navigation;
	const routePath = location.kind === "route" ? location.path : undefined;
	const entityId = location.kind === "entity" ? location.entityId : undefined;
	const routeSearch = location.kind === "route" ? location.search : undefined;
	const entitySchemaSlug = location.kind === "entity" ? location.entitySchemaSlug : undefined;
	const subscribeResume = props.subscribeResume;
	const latest = useRef(props);
	const artifactSrc = useRef(props.artifactGrant.src);
	const frame = useRef<HTMLIFrameElement>(null);
	const backSettle = useRef<number>(undefined);
	const bridge = useRef<PluginBridgeSession>(undefined);
	const markArtifactStale = useRef<(() => void) | undefined>(undefined);
	const freshnessRevision = useRef(props.freshnessCheckRevision);
	const documentKey = useRef(props.documentKey);
	const mutationRevision = useRef(0);
	const refreshedMutationRevision = useRef(0);
	const [overlayCount, setOverlayCount] = useState(0);
	const [pageShortcuts, setPageShortcuts] = useState<readonly PageShortcutKey[]>([]);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [frameStatus, setFrameStatus] = useState<"ready" | "loading" | "handshake-failure">(
		"loading",
	);
	const [reload, setReload] = useState(0);
	latest.current = props;

	const closeBridge = () => {
		bridge.current?.close();
		bridge.current = undefined;
		latest.current.onScreenState(null);
		setOverlayCount(0);
		setPageShortcuts([]);
		latest.current.onOverlayState(0);
	};
	const reloadArtifact = () => {
		closeBridge();
		setFrameStatus("loading");
		setReload((value) => value + 1);
	};

	useEffect(() => {
		markArtifactStale.current = () => setUpdateAvailable(true);
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
			closeBridge();
			markArtifactStale.current = undefined;
			document.removeEventListener("visibilitychange", onVisibilityChange);
			releaseResume();
		};
	}, [subscribeResume, reload]);

	useEffect(() => {
		if (freshnessRevision.current === props.freshnessCheckRevision) {
			return undefined;
		}
		freshnessRevision.current = props.freshnessCheckRevision;
		const controller = new AbortController();
		void latest.current
			.onCheckFreshness(controller.signal)
			.then((current) => {
				if (!controller.signal.aborted && !current) {
					setUpdateAvailable(true);
				}
				return undefined;
			})
			.catch(() => undefined);
		return () => controller.abort();
	}, [props.freshnessCheckRevision, props.documentKey]);

	useEffect(() => {
		const current = latest.current;
		if (documentKey.current === current.documentKey) {
			return;
		}
		documentKey.current = current.documentKey;
		setUpdateAvailable(false);
		setOverlayCount(0);
		setPageShortcuts([]);
		current.onOverlayState(0);
		current.onScreenState(null);
		current.onHeader({ title: null, key: current.navigation.key, index: current.navigation.index });
		if (current.page) {
			bridge.current?.sendDocument(current.documentKey, current.page, current.navigation);
		}
	}, [props.documentKey]);

	useEffect(() => {
		if (!props.active) {
			return;
		}
		window.clearTimeout(backSettle.current);
		bridge.current?.sendLocation(latest.current.navigation);
	}, [
		props.active,
		compact,
		edgeBack,
		entityId,
		entitySchemaSlug,
		index,
		key,
		leading,
		routePath,
		routeSearch,
	]);

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
			artifactHash: props.artifactHash,
			viewport: latest.current.viewport,
			navigation: latest.current.navigation,
			onReady: () => setFrameStatus("ready"),
			documentKey: latest.current.documentKey,
			theme: latest.current.theme.getSnapshot(),
			onOpenDrawer: () => latest.current.onOpenDrawer(),
			onPageSearch: (request) => latest.current.onPageSearch(request),
			onRyotQL: (request, signal) => latest.current.onQuery(request, signal),
			onProviderSearch: (request) => latest.current.onProviderSearch(request),
			onAssets: (request, signal) => latest.current.onAssets(request, signal),
			onUpload: (request, signal) => latest.current.onUpload(request, signal),
			onKernelShortcut: (shortcut) => latest.current.onKernelShortcut(shortcut),
			onCollection: (request, signal) => latest.current.onCollection(request, signal),
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
				const navigation = toNavigationRequest(request);
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
			onOperation: async (request, signal) => {
				const outcome = await latest.current.onInvokeOperation(request, signal);
				if (outcome.outcome !== "stale-session") {
					return outcome;
				}
				if (bridge.current === connection.session) {
					markArtifactStale.current?.();
				}
				return { outcome: "failure", reason: "operation-failed" } satisfies PluginOperationOutcome;
			},
		});
		if (!connection.failed) {
			connection.session = nextBridge;
			bridge.current = nextBridge;
		}
	}

	const chrome = { compact, leading: props.chromeLeading, safeAreaTop: props.viewport.safeAreaTop };
	if (frameStatus === "handshake-failure") {
		return <PluginNotice {...chrome} status={frameStatus} onReload={reloadArtifact} />;
	}

	return (
		<div className="relative h-full w-full">
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
			<iframe
				key={reload}
				onLoad={connect}
				sandbox="allow-scripts"
				src={artifactSrc.current}
				referrerPolicy="no-referrer"
				title={`${props.title} plugin`}
				inert={props.inert === true || updateAvailable}
				className={clsx("h-full w-full border-0", frameStatus !== "ready" && "invisible")}
				ref={(node) => {
					frame.current = node;
					if (props.active) {
						props.chromeTriggerRef.current = node;
					}
				}}
			/>
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
	press.current = props.onPress;
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
	readonly onReload?: () => void;
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
				<PluginNoticePanel status={props.status} onReload={props.onReload} />
			</PluginChromeFrame>
		</div>
	);
}

function PluginNoticePanel(props: {
	readonly onReload?: () => void;
	readonly status: PluginHostStatus;
}) {
	return (
		<section className="ui-stack ui-card mx-auto w-[min(100%,480px)]">
			<p className="text-text-muted" role={props.status === "loading" ? "status" : "alert"}>
				{noticeMessages[props.status]}
			</p>
			{props.onReload ? (
				<Button type="button" onClick={props.onReload}>
					Reload plugin
				</Button>
			) : null}
		</section>
	);
}
