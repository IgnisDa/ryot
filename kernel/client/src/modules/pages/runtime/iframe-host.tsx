import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import type { ClientCompositionDocument } from "@ryot-app/contract/modules/pages/schemas";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	CLIENT_BRIDGE_BOOTSTRAP,
	PluginBridgeBootstrapProof,
} from "@ryot-app/plugin-client-contract";
import type {
	AddToCollectionOutcome,
	AddToCollectionRequest,
	ChangeCollectionMembersOutcome,
	ChangeCollectionMembersRequest,
	ClientPageContext,
	EditCollectionOutcome,
	EditCollectionRequest,
	ExternalLinkOutcome,
	ExternalLinkRequest,
	KernelShortcut,
	ManageCollectionReviewsOutcome,
	ManageCollectionReviewsRequest,
	ManageRemindersOutcome,
	ManageRemindersRequest,
	PageShortcutKey,
	PickEntityOutcome,
	PluginAccountOutcome,
	PluginAssetOutcome,
	PluginAssetRequest,
	PluginBackgroundOperationRequest,
	PluginBridgeNavigate,
	PluginBridgePageSearch,
	PluginBridgePickEntityScreen,
	PluginCalendarSourceVisibilityOutcome,
	PluginCalendarSourceVisibilityRequest,
	PluginCollectionOutcome,
	PluginCollectionRequest,
	PluginDeviceOutcome,
	PluginDeviceRequest,
	PluginEnrichmentOutcome,
	PluginEnrichmentRequest,
	PluginEntitySaveOutcome,
	PluginIosLiveActivityOutcome,
	PluginIosLiveActivityRequest,
	PluginOperationOutcome,
	PluginOperationRequest,
	PluginRyotQLOutcome,
	PluginRyotQLRequest,
	PluginStorageOutcome,
	PluginStorageRequest,
	PluginUploadOutcome,
	PluginUploadRequest,
	PluginUserSettingsOutcome,
	PluginUserSettingsRequest,
	SharePublicationOutcome,
	SharePublicationRequest,
} from "@ryot-app/plugin-client-contract";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { Button, ScreenFrame, StatusMessage, useShortcut } from "@ryot-app/plugin-ui-sdk";
import { createUuid } from "@ryot-app/ts-utils/uuid";
import clsx from "clsx";
import { Effect, Result, Schema } from "effect";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type { ServerOrigin } from "#/api/origin";
import type { BackgroundSubmissionBinding } from "#/modules/background-submissions/service";
import type { WatchEntities } from "#/modules/entity-watches/service";
import { subscribeNativeResume } from "#/modules/entity-watches/transport";
import { useI18nSnapshot } from "#/modules/i18n/provider";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import type { PluginOperationDispatchOutcome } from "#/modules/pages/bridge/operations";
import {
	type BackgroundOperationAcceptance,
	bridgeCatalogNamespaces,
	bridgeLocaleState,
	isDisplayTextAllowed,
	openPluginBridge,
	type PluginBridgeNavigationState,
	type PluginBridgeSession,
	type PluginBridgeViewportInsets,
} from "#/modules/pages/bridge/session";
import { renderClientDocument } from "#/modules/pages/documents/srcdoc";
import { ClientPageLoading } from "#/modules/pages/loading";
import type { PageHeaderPublication, PageScreenReadiness } from "#/modules/shell/page-presentation";
import type { ThemeStore } from "#/modules/theme/store";

const PLUGIN_BACK_SETTLE_MS = 500;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const decodeBootstrapProof = Schema.decodeUnknownResult(PluginBridgeBootstrapProof);

const afterFlush = (
	session: undefined | PluginBridgeSession,
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
	readonly title: Text;
	readonly icon?: string;
	readonly active: boolean;
	readonly inert?: boolean;
	readonly theme: ThemeStore;
	readonly embedded?: boolean;
	readonly documentKey: string;
	readonly compositionHash: string;
	readonly serverUrl: ServerOrigin;
	readonly page?: ClientPageContext;
	readonly chromeLeading: ReactNode;
	readonly onOpenDrawer: () => void;
	readonly onNavigateBack: () => void;
	readonly onReloadCurrent: () => void;
	readonly watchEntities: WatchEntities;
	readonly freshnessCheckRevision: number;
	readonly onReleaseResources: () => void;
	readonly backInterceptors: BackInterceptors;
	readonly viewport: PluginBridgeViewportInsets;
	readonly navigation: PluginBridgeNavigationState;
	readonly onOverlayState: (count: number) => void;
	readonly chromeTriggerRef: RefObject<null | HTMLElement>;
	readonly onHeader: (header: PageHeaderPublication) => void;
	readonly mutationCompleted: RyotClient["mutationCompleted"];
	readonly onNavigate: (request: PluginBridgeNavigate) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onAccount: () => Effect.Effect<PluginAccountOutcome>;
	readonly onCheckFreshness: () => Effect.Effect<boolean, Error>;
	readonly subscribeResume?: (resumed: () => void) => () => void;
	readonly onPageSearch: (request: PluginBridgePageSearch) => void;
	readonly onScreenState: (state: null | PageScreenReadiness) => void;
	readonly onLoadDocument: () => Effect.Effect<ClientCompositionDocument, Error>;
	readonly onFlushReady: (flush: undefined | (() => Effect.Effect<boolean>)) => void;
	readonly onAssets: (request: PluginAssetRequest) => Effect.Effect<PluginAssetOutcome>;
	readonly onQuery: (request: PluginRyotQLRequest) => Effect.Effect<PluginRyotQLOutcome>;
	readonly onUpload: (request: PluginUploadRequest) => Effect.Effect<PluginUploadOutcome>;
	readonly onDevice: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceOutcome>;
	readonly onStorage: (request: PluginStorageRequest) => Effect.Effect<PluginStorageOutcome>;
	readonly onExternalLink: (request: ExternalLinkRequest) => Effect.Effect<ExternalLinkOutcome>;
	readonly onPickEntity: (
		request: PluginBridgePickEntityScreen,
	) => Effect.Effect<PickEntityOutcome>;
	readonly onEditCollection: (
		request: EditCollectionRequest,
	) => Effect.Effect<EditCollectionOutcome>;
	readonly onCollection: (
		request: PluginCollectionRequest,
	) => Effect.Effect<PluginCollectionOutcome>;
	readonly onEntitySave: (
		request: EntityEditorSaveRequest,
	) => Effect.Effect<PluginEntitySaveOutcome>;
	readonly onEnrichment: (
		request: PluginEnrichmentRequest,
	) => Effect.Effect<PluginEnrichmentOutcome>;
	readonly onAddToCollection: (
		request: AddToCollectionRequest,
	) => Effect.Effect<AddToCollectionOutcome>;
	readonly onManageReminders: (
		request: ManageRemindersRequest,
	) => Effect.Effect<ManageRemindersOutcome>;
	readonly onSharePublication: (
		request: SharePublicationRequest,
	) => Effect.Effect<SharePublicationOutcome>;
	readonly onUserSettings: (
		request: PluginUserSettingsRequest,
	) => Effect.Effect<PluginUserSettingsOutcome>;
	readonly onInvokeOperation: (
		request: PluginOperationRequest,
	) => Effect.Effect<PluginOperationDispatchOutcome>;
	readonly onIosLiveActivity: (
		request: PluginIosLiveActivityRequest,
	) => Effect.Effect<PluginIosLiveActivityOutcome>;
	readonly onManageCollectionReviews: (
		request: ManageCollectionReviewsRequest,
	) => Effect.Effect<ManageCollectionReviewsOutcome>;
	readonly onChangeCollectionMembers: (
		request: ChangeCollectionMembersRequest,
	) => Effect.Effect<ChangeCollectionMembersOutcome>;
	readonly onCalendarSourceVisibility: (
		request: PluginCalendarSourceVisibilityRequest,
	) => Effect.Effect<PluginCalendarSourceVisibilityOutcome>;
	readonly onBackgroundOperation: (
		request: PluginBackgroundOperationRequest,
		binding: BackgroundSubmissionBinding,
	) => Effect.Effect<BackgroundOperationAcceptance>;
}) {
	const { key, index, compact, leading, edgeBack, location } = props.navigation;
	const routePath = location.kind === "route" ? location.path : undefined;
	const entityId = location.kind === "entity" ? location.entityId : undefined;
	const routeSearch = location.kind === "route" ? location.search : undefined;
	const entitySchemaSlug = location.kind === "entity" ? location.entitySchemaSlug : undefined;
	const { subscribeResume, chromeTriggerRef } = props;
	const latest = useRef(props);
	const [srcDoc, setSrcDoc] = useState<string>();
	const frame = useRef<HTMLIFrameElement>(null);
	const backSettle = useRef<number>(undefined);
	const bridge = useRef<PluginBridgeSession>(undefined);
	const markCompositionStale = useRef<undefined | (() => void)>(undefined);
	const freshnessRevision = useRef(props.freshnessCheckRevision);
	const documentKey = useRef(props.documentKey);
	const mutationRevision = useRef(0);
	const refreshedMutationRevision = useRef(0);
	const [overlayCount, setOverlayCount] = useState(0);
	const [pageShortcuts, setPageShortcuts] = useState<readonly PageShortcutKey[]>([]);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const updatePending = useRef(false);
	const [persistenceFailed, setPersistenceFailed] = useState(false);
	const [frameStatus, setFrameStatus] = useState<"ready" | "loading" | "handshake-failure">(
		"loading",
	);
	useLayoutEffect(() => {
		latest.current = props;
		updatePending.current = updateAvailable;
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

	const t = useT();
	const { locale, registry, pluginCatalogs } = useI18nSnapshot();
	const namespaces =
		props.page === undefined
			? new Set([KERNEL_NAMESPACE])
			: bridgeCatalogNamespaces(props.page.contributors);
	const namespacesKey = namespaces === undefined ? undefined : [...namespaces].sort().join("\n");
	const pluginCatalogsLoading = pluginCatalogs === "loading";
	const bridgeLocale = useMemo(
		() =>
			bridgeLocaleState(
				locale,
				registry,
				namespacesKey === undefined ? undefined : new Set(namespacesKey.split("\n")),
				pluginCatalogsLoading,
			),
		[locale, registry, namespacesKey, pluginCatalogsLoading],
	);
	const latestLocale = useRef(bridgeLocale);
	useEffect(() => {
		latestLocale.current = bridgeLocale;
		bridge.current?.sendLocale(bridgeLocale);
	}, [bridgeLocale]);

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

	const connect = useEffectEvent((port: MessagePort) => {
		const connection: { failed: boolean; session?: PluginBridgeSession } = { failed: false };
		const manageScreen = Effect.fnUntraced(function* <Outcome extends { readonly kind: string }>(
			open: () => Effect.Effect<Outcome>,
		) {
			const acceptedDocumentKey = latest.current.documentKey;
			const outcome = yield* open();
			if (
				outcome.kind === "changed" &&
				latest.current.documentKey === acceptedDocumentKey &&
				bridge.current === connection.session
			) {
				latest.current.mutationCompleted.hint();
			}
			return outcome;
		});
		const nextBridge = openPluginBridge({
			port,
			page: latest.current.page,
			locale: latestLocale.current,
			viewport: latest.current.viewport,
			navigation: latest.current.navigation,
			compositionHash: props.compositionHash,
			onReady: () => setFrameStatus("ready"),
			documentKey: latest.current.documentKey,
			theme: latest.current.theme.getSnapshot(),
			onAccount: () => latest.current.onAccount(),
			onOpenDrawer: () => latest.current.onOpenDrawer(),
			onRyotQL: (request) => latest.current.onQuery(request),
			onAssets: (request) => latest.current.onAssets(request),
			onUpload: (request) => latest.current.onUpload(request),
			onDevice: (request) => latest.current.onDevice(request),
			onStorage: (request) => latest.current.onStorage(request),
			onNavigate: (request) => latest.current.onNavigate(request),
			onPageSearch: (request) => latest.current.onPageSearch(request),
			onCollection: (request) => latest.current.onCollection(request),
			onEntitySave: (request) => latest.current.onEntitySave(request),
			onPickEntity: (request) => latest.current.onPickEntity(request),
			onEnrichment: (request) => latest.current.onEnrichment(request),
			onUserSettings: (request) => latest.current.onUserSettings(request),
			onExternalLink: (request) => latest.current.onExternalLink(request),
			onEditCollection: (request) => latest.current.onEditCollection(request),
			onAddToCollection: (request) => latest.current.onAddToCollection(request),
			onIosLiveActivity: (request) => latest.current.onIosLiveActivity(request),
			onKernelShortcut: (shortcut) => latest.current.onKernelShortcut(shortcut),
			onSharePublication: (request) => latest.current.onSharePublication(request),
			watchEntities: (interest, onUpdate) => latest.current.watchEntities(interest, onUpdate),
			onCalendarSourceVisibility: (request) => latest.current.onCalendarSourceVisibility(request),
			onManageReminders: (request) => manageScreen(() => latest.current.onManageReminders(request)),
			onManageCollectionReviews: (request) =>
				manageScreen(() => latest.current.onManageCollectionReviews(request)),
			onChangeCollectionMembers: (request) =>
				manageScreen(() => latest.current.onChangeCollectionMembers(request)),
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
			onNavigateBack: () => {
				latest.current.onNavigateBack();
				window.clearTimeout(backSettle.current);
				backSettle.current = window.setTimeout(
					() => bridge.current?.sendLocation(latest.current.navigation),
					PLUGIN_BACK_SETTLE_MS,
				);
			},
			onBackgroundOperation: (request, binding) =>
				!latest.current.active || latest.current.inert === true || updatePending.current
					? Effect.succeed({ outcome: "failure", reason: "operation-failed" })
					: latest.current.onBackgroundOperation(request, binding),
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
			onHeader: (request) => {
				const current = latest.current.navigation;
				const title = request.header?.title ?? null;
				const allowedNamespaces =
					latest.current.page === undefined
						? new Set([KERNEL_NAMESPACE])
						: bridgeCatalogNamespaces(latest.current.page.contributors);
				if (
					request.index === current.index &&
					request.key === current.key &&
					(title === null || isDisplayTextAllowed(title, allowedNamespaces))
				) {
					latest.current.onHeader({ title, key: request.key, index: request.index });
				}
			},
		});
		if (!connection.failed) {
			connection.session = nextBridge;
			bridge.current = nextBridge;
			latest.current.onFlushReady(nextBridge.requestFlush);
		}
	});

	useLayoutEffect(() => {
		const controller = new AbortController();
		const nonce = createUuid();
		const offered = new Set<MessagePort>();
		const { serverUrl, compositionHash } = latest.current;
		const stop = () => {
			controller.abort();
			window.clearTimeout(timeout);
			window.removeEventListener("message", onOffer);
			for (const port of offered) {
				port.close();
			}
			offered.clear();
		};
		const fail = () => {
			stop();
			failHandshake();
		};
		const onOffer = (event: MessageEvent<unknown>) => {
			const source = frame.current?.contentWindow;
			if (!source || event.source !== source || event.data !== CLIENT_BRIDGE_BOOTSTRAP) {
				return;
			}
			if (event.origin !== "null" || event.ports.length !== 1) {
				for (const extra of event.ports) {
					extra.close();
				}
				return;
			}
			const [port] = event.ports;
			const discard = () => {
				port.removeEventListener("message", onProof);
				port.removeEventListener("messageerror", discard);
				offered.delete(port);
				port.close();
			};
			const onProof = ({ data }: MessageEvent<unknown>) => {
				const proof = decodeBootstrapProof(data);
				if (
					frame.current?.contentWindow !== source ||
					Result.isFailure(proof) ||
					proof.success.nonce !== nonce ||
					proof.success.composition.hash !== compositionHash
				) {
					discard();
					return;
				}
				offered.delete(port);
				stop();
				connect(port);
			};
			offered.add(port);
			const once = { once: true, signal: controller.signal };
			port.addEventListener("messageerror", discard, once);
			port.addEventListener("message", onProof, once);
			port.start();
		};
		const timeout = window.setTimeout(fail, BOOTSTRAP_TIMEOUT_MS);
		window.addEventListener("message", onOffer);
		Effect.runFork(
			latest.current
				.onLoadDocument()
				.pipe(
					Effect.match({
						onFailure: fail,
						onSuccess: (document) => setSrcDoc(renderClientDocument(document, serverUrl, nonce)),
					}),
				),
			{ signal: controller.signal },
		);
		return stop;
	}, []);

	const chrome = { compact, leading: props.chromeLeading, safeAreaTop: props.viewport.safeAreaTop };
	if (frameStatus === "handshake-failure" && props.embedded) {
		return (
			<div role="alert">
				<p>{t(kernelMessage("client.pages.host.preview-failed"))}</p>
				<Button onClick={retryDocument}>
					{t(kernelMessage("client.pages.host.retry-preview"))}
				</Button>
			</div>
		);
	}
	if (frameStatus === "handshake-failure") {
		return <PluginNotice {...chrome} onRetry={retryDocument} />;
	}

	return (
		<div className="relative h-full w-full">
			{persistenceFailed && (
				<div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between gap-2 bg-surface px-4 py-2 text-sm">
					<StatusMessage tone="error">
						{t(kernelMessage("client.pages.host.save-failed"))}
					</StatusMessage>
					<Button type="button" variant="secondary" onClick={retryDocument}>
						{t(kernelMessage("common.action.retry"))}
					</Button>
				</div>
			)}
			{frameStatus === "ready" &&
				props.active &&
				props.inert !== true &&
				props.embedded !== true &&
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
					inert={props.inert === true || updateAvailable}
					title={t(kernelMessage("client.pages.host.frame-title", { title: props.title }))}
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
					{props.embedded ? (
						<p role="status">{t(kernelMessage("client.pages.preview.loading"))}</p>
					) : (
						<ClientPageLoading
							{...chrome}
							icon={props.icon}
							title={t(kernelMessage("client.pages.host.opening", { title: props.title }))}
						/>
					)}
				</div>
			)}
			{updateAvailable && props.embedded ? (
				<p role="status">{t(kernelMessage("client.pages.host.preview-changed"))}</p>
			) : null}
			{updateAvailable && !props.embedded ? (
				<div className="absolute inset-0">
					<PluginChromeFrame
						compact={compact}
						leading={props.chromeLeading}
						safeAreaTop={props.viewport.safeAreaTop}
						title={t(kernelMessage("client.pages.host.update-title"))}
					>
						<section className="ui-stack ui-card mx-auto w-[min(100%,480px)]">
							<p role="alert" className="text-text-muted">
								{t(kernelMessage("client.pages.host.update-detail"))}
							</p>
							<Button type="button" onClick={props.onReloadCurrent}>
								{t(kernelMessage("client.pages.host.update-reload"))}
							</Button>
						</section>
					</PluginChromeFrame>
				</div>
			) : null}
		</div>
	);
}

function PageShortcut(props: { readonly onPress: () => void; readonly shortcut: PageShortcutKey }) {
	const press = useRef(props.onPress);
	useLayoutEffect(() => {
		press.current = props.onPress;
	});
	useShortcut(props.shortcut, () => press.current());
	return null;
}

function PluginChromeFrame(props: {
	readonly title: Text;
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
	readonly onRetry: () => void;
}) {
	const t = useT();
	return (
		<div className="h-full">
			<PluginChromeFrame
				compact={props.compact}
				leading={props.leading}
				safeAreaTop={props.safeAreaTop}
				title={t(kernelMessage("client.pages.host.unavailable-title"))}
			>
				<section className="ui-stack ui-card mx-auto w-[min(100%,480px)]">
					<p role="alert" className="text-text-muted">
						{t(kernelMessage("client.pages.host.unavailable-detail"))}
					</p>
					<Button type="button" onClick={props.onRetry}>
						{t(kernelMessage("common.action.retry"))}
					</Button>
				</section>
			</PluginChromeFrame>
		</div>
	);
}
