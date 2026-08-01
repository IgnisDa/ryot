import type {
	ClientPageContext,
	KernelShortcut,
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
import { Button, ScreenFrame } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { WatchEntities } from "#/modules/entity-interest/service";
import { subscribeNativeResume } from "#/modules/entity-interest/transport";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { mainContentProps } from "#/modules/navigation/skip-link";
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

const ARTIFACT_SESSION_RENEWAL_LEAD_MS = 5 * 60_000;
const ARTIFACT_SESSION_RETRY_MS = 30_000;
const PLUGIN_BACK_SETTLE_MS = 500;

export type PluginArtifactSession = {
	readonly src: string;
	readonly expiresAt: string;
	readonly sessionId: string;
};

export type PluginHeaderPublication = {
	readonly index: number;
	readonly key: string;
	readonly title: string | null;
};

export type CreatePluginArtifactSession = (
	request: {
		readonly sourceHash: string;
		readonly artifactHash: string;
		readonly installationId: string;
	},
	signal: AbortSignal,
) => Promise<PluginArtifactSession>;

export type RenewPluginArtifactSession = (
	sessionId: string,
	signal: AbortSignal,
) => Promise<
	| { readonly outcome: "renewed"; readonly expiresAt: string }
	| { readonly outcome: "replace"; readonly reason: "stale" | "not-found" }
>;

export type RevokePluginArtifactSession = (sessionId: string) => Promise<void>;

type PluginHostStatus = "loading" | "handshake-failure" | "artifact-session-failure";

type ArtifactGeneration =
	| { readonly status: "creating"; readonly generation: number }
	| { readonly status: "failed"; readonly generation: number }
	| {
			readonly status: "active";
			readonly generation: number;
			readonly session: PluginArtifactSession;
	  };

const noticeMessages: Record<PluginHostStatus, string> = {
	loading: "Preparing this plugin...",
	"handshake-failure": "This plugin stopped working.",
	"artifact-session-failure": "This plugin could not be loaded.",
};

export function PluginFrame(props: {
	readonly title: string;
	readonly inert?: boolean;
	readonly theme: ThemeStore;
	readonly sourceHash: string;
	readonly artifactHash: string;
	readonly installationId: string;
	readonly page?: ClientPageContext;
	readonly chromeLeading: ReactNode;
	readonly onOpenDrawer: () => void;
	readonly onStaleSession: () => void;
	readonly onNavigateBack: () => void;
	readonly watchEntities: WatchEntities;
	readonly artifactSessionScopeKey: string;
	readonly backInterceptors: BackInterceptors;
	readonly viewport: PluginBridgeViewportInsets;
	readonly navigation: PluginBridgeNavigationState;
	readonly onOverlayState: (count: number) => void;
	readonly chromeTriggerRef: RefObject<HTMLElement | null>;
	readonly mutationCompleted: RyotClient["mutationCompleted"];
	readonly subscribeResume?: (resumed: () => void) => () => void;
	readonly onRenewArtifactSession: RenewPluginArtifactSession;
	readonly onHeader: (header: PluginHeaderPublication) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onCreateArtifactSession: CreatePluginArtifactSession;
	readonly onRevokeArtifactSession: RevokePluginArtifactSession;
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
	const { compact, edgeBack, index, key, leading, location } = props.navigation;
	const routePath = location.kind === "route" ? location.path : undefined;
	const entityId = location.kind === "entity" ? location.entityId : undefined;
	const routeSearch = location.kind === "route" ? location.search : undefined;
	const entitySchemaSlug = location.kind === "entity" ? location.entitySchemaSlug : undefined;
	const subscribeResume = props.subscribeResume;
	const latest = useRef(props);
	const frame = useRef<HTMLIFrameElement>(null);
	const backSettle = useRef<number>(undefined);
	const bridge = useRef<PluginBridgeSession>(undefined);
	const [overlayCount, setOverlayCount] = useState(0);
	const [frameStatus, setFrameStatus] = useState<"ready" | "loading" | "handshake-failure">(
		"loading",
	);
	const [reload, setReload] = useState(0);
	const [artifact, setArtifact] = useState<ArtifactGeneration>({
		generation: 0,
		status: "creating",
	});
	latest.current = props;

	const closeBridge = () => {
		bridge.current?.close();
		bridge.current = undefined;
		latest.current.onScreenState(null);
		setOverlayCount(0);
		latest.current.onOverlayState(0);
	};
	const reloadArtifact = () => {
		closeBridge();
		setReload((value) => value + 1);
	};

	useEffect(() => {
		let disposed = false;
		let renewing = false;
		const generation = reload;
		const lifecycle = latest.current;
		let expiryTimer: number | undefined;
		let renewalTimer: number | undefined;
		const create = new AbortController();
		const renewal = new AbortController();
		let active: PluginArtifactSession | undefined;

		setArtifact({ generation, status: "creating" });
		setFrameStatus("loading");

		const revoke = (sessionId: string) => {
			void lifecycle.onRevokeArtifactSession(sessionId).catch(() => undefined);
		};
		const replace = (stale: boolean) => {
			if (disposed) {
				return;
			}
			closeBridge();
			renewal.abort();
			const detached = active;
			active = undefined;
			setArtifact({ generation, status: "creating" });
			if (stale) {
				latest.current.onStaleSession();
			}
			setReload((value) => value + 1);
			if (detached !== undefined) {
				revoke(detached.sessionId);
			}
		};
		const schedule = () => {
			if (disposed || active === undefined) {
				return;
			}
			window.clearTimeout(expiryTimer);
			window.clearTimeout(renewalTimer);
			const expiresAt = Date.parse(active.expiresAt);
			const remaining = Math.max(0, expiresAt - Date.now());
			expiryTimer = window.setTimeout(() => replace(false), remaining);
			renewalTimer = window.setTimeout(
				() => void renew(),
				Math.max(0, remaining - ARTIFACT_SESSION_RENEWAL_LEAD_MS),
			);
		};
		const retry = () => {
			if (active === undefined) {
				return;
			}
			const remaining = Date.parse(active.expiresAt) - Date.now();
			if (remaining <= 0) {
				replace(false);
				return;
			}
			renewalTimer = window.setTimeout(
				() => void renew(),
				Math.min(ARTIFACT_SESSION_RETRY_MS, remaining),
			);
		};
		async function renew() {
			if (disposed || renewing || active === undefined) {
				return;
			}
			if (Date.parse(active.expiresAt) <= Date.now()) {
				replace(false);
				return;
			}
			renewing = true;
			const current = active;
			try {
				const result = await lifecycle.onRenewArtifactSession(current.sessionId, renewal.signal);
				if (renewal.signal.aborted || active !== current) {
					return;
				}
				if (result.outcome === "replace") {
					replace(true);
					return;
				}
				active = { ...current, expiresAt: result.expiresAt };
				setArtifact({ generation, session: active, status: "active" });
				schedule();
			} catch {
				if (!renewal.signal.aborted && active === current) {
					retry();
				}
			} finally {
				renewing = false;
			}
		}
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") {
				return;
			}
			bridge.current?.sendPageRefresh();
			if (active === undefined) {
				return;
			}
			if (Date.parse(active.expiresAt) <= Date.now()) {
				replace(false);
				return;
			}
			if (Date.parse(active.expiresAt) - Date.now() <= ARTIFACT_SESSION_RENEWAL_LEAD_MS) {
				void renew();
			}
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		const releaseResume = (subscribeResume ?? subscribeNativeResume)(() =>
			bridge.current?.sendPageRefresh(),
		);
		void lifecycle
			.onCreateArtifactSession(
				{
					sourceHash: props.sourceHash,
					artifactHash: props.artifactHash,
					installationId: props.installationId,
				},
				create.signal,
			)
			.then((created) => {
				if (disposed) {
					revoke(created.sessionId);
					return undefined;
				}
				active = created;
				setArtifact({ generation, session: created, status: "active" });
				schedule();
				return undefined;
			})
			.catch(() => {
				if (!disposed) {
					setArtifact({ generation, status: "failed" });
				}
			});

		return () => {
			disposed = true;
			closeBridge();
			create.abort();
			renewal.abort();
			window.clearTimeout(expiryTimer);
			window.clearTimeout(renewalTimer);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			releaseResume();
			const detached = active;
			active = undefined;
			if (detached !== undefined) {
				revoke(detached.sessionId);
			}
		};
	}, [
		props.artifactHash,
		props.artifactSessionScopeKey,
		props.installationId,
		props.sourceHash,
		subscribeResume,
		reload,
	]);

	useEffect(() => {
		window.clearTimeout(backSettle.current);
		bridge.current?.sendLocation(latest.current.navigation);
	}, [compact, edgeBack, entityId, entitySchemaSlug, index, key, leading, routePath, routeSearch]);

	useEffect(
		() =>
			props.theme.subscribe(() => {
				bridge.current?.sendTheme(props.theme.getSnapshot());
			}),
		[props.theme],
	);

	useEffect(() => {
		if (overlayCount === 0) {
			return undefined;
		}
		return props.backInterceptors.register(() => bridge.current?.requestOverlayDismiss() ?? false, {
			priority: "iframe",
		});
	}, [overlayCount, props.backInterceptors]);

	useEffect(() => {
		bridge.current?.sendViewport(props.viewport);
	}, [props.viewport]);

	useEffect(
		() => props.mutationCompleted.subscribe(() => bridge.current?.sendPageRefresh()),
		[props.mutationCompleted],
	);

	function connect() {
		if (artifact.status !== "active") {
			return;
		}
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
			theme: latest.current.theme.getSnapshot(),
			onReady: () => setFrameStatus("ready"),
			onOpenDrawer: () => latest.current.onOpenDrawer(),
			onPageSearch: (request) => latest.current.onPageSearch(request),
			onRyotQL: (request, signal) => latest.current.onQuery(request, signal),
			onProviderSearch: (request) => latest.current.onProviderSearch(request),
			onAssets: (request, signal) => latest.current.onAssets(request, signal),
			onUpload: (request, signal) => latest.current.onUpload(request, signal),
			onKernelShortcut: (shortcut) => latest.current.onKernelShortcut(shortcut),
			onCollection: (request, signal) => latest.current.onCollection(request, signal),
			watchEntities: (interest, onUpdate) => latest.current.watchEntities(interest, onUpdate),
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
			onFailure: () => {
				connection.failed = true;
				closeBridge();
				setFrameStatus("handshake-failure");
			},
			onNavigate: (request) => {
				const navigation = toNavigationRequest(request);
				if (navigation !== undefined) {
					latest.current.onNavigate(navigation);
				}
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
			onNavigateBack: () => {
				latest.current.onNavigateBack();
				window.clearTimeout(backSettle.current);
				backSettle.current = window.setTimeout(
					() => bridge.current?.sendLocation(latest.current.navigation),
					PLUGIN_BACK_SETTLE_MS,
				);
			},
			onOperation: async (request, signal) => {
				const outcome = await latest.current.onInvokeOperation(request, signal);
				if (outcome.outcome !== "stale-session") {
					return outcome;
				}
				if (bridge.current === connection.session) {
					closeBridge();
					setArtifact({ generation: artifact.generation, status: "creating" });
					latest.current.onStaleSession();
					setReload((value) => value + 1);
				}
				return { outcome: "failure", reason: "transport" } satisfies PluginOperationOutcome;
			},
		});
		if (!connection.failed) {
			connection.session = nextBridge;
			bridge.current = nextBridge;
		}
	}

	const chrome = { compact, leading: props.chromeLeading, safeAreaTop: props.viewport.safeAreaTop };
	if (artifact.status === "creating") {
		return <PluginNotice {...chrome} status="loading" />;
	}
	if (artifact.status === "failed") {
		return <PluginNotice {...chrome} status="artifact-session-failure" onReload={reloadArtifact} />;
	}
	if (frameStatus === "handshake-failure") {
		return <PluginNotice {...chrome} status={frameStatus} onReload={reloadArtifact} />;
	}

	return (
		<main {...mainContentProps} className="relative h-full w-full">
			<iframe
				onLoad={connect}
				inert={props.inert}
				sandbox="allow-scripts"
				src={artifact.session.src}
				referrerPolicy="no-referrer"
				title={`${props.title} plugin`}
				className={clsx("h-full w-full border-0", frameStatus !== "ready" && "invisible")}
				ref={(node) => {
					frame.current = node;
					props.chromeTriggerRef.current = node;
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
		</main>
	);
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
		<main {...mainContentProps} className="h-full">
			<PluginChromeFrame
				compact={props.compact}
				leading={props.leading}
				safeAreaTop={props.safeAreaTop}
				title={props.status === "loading" ? "Loading plugin" : "Plugin unavailable"}
			>
				<PluginNoticePanel status={props.status} onReload={props.onReload} />
			</PluginChromeFrame>
		</main>
	);
}

function PluginNoticePanel(props: {
	readonly onReload?: () => void;
	readonly status: PluginHostStatus;
}) {
	return (
		<section className="ui-stack ui-card mx-auto w-[min(100%,480px)]">
			<p role={props.status === "loading" ? "status" : "alert"} className="text-text-muted">
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
