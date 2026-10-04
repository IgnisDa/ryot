import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type ExternalLinkOutcome,
	type ExternalLinkRequest,
	PluginBridgeClientMessage,
	PluginBridgeHostMessage,
	PluginBridgeLifecycleClose,
	PluginBridgeReady,
	isPageShortcut,
	type KernelShortcut,
	type PageShortcutKey,
	type ClientPageContext,
	type PluginAssetOutcome,
	type PluginAssetRequest,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeCollectionRequest,
	type PluginBridgeEntitySaveRequest,
	type PluginBridgeDismissOverlay,
	type PluginBridgeDismissOverlayResult,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeDocument,
	type PluginBridgeHeader,
	type PluginBridgeNavigate,
	type PluginBridgePageSearch,
	type PluginBridgePageRefresh,
	type PluginBridgePageShortcutPress,
	type PluginBridgePickEntityScreen,
	type PluginBridgeTheme,
	type PluginBridgeViewport,
	type PluginBridgeOperationRequest,
	type PluginBridgeOverlayState,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeStorageRequest,
	type PluginBridgeUploadRequest,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginUploadOutcome,
	type PluginUploadRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
	type PluginThemeSnapshot,
	type PluginCollectionOutcome,
	type PluginCollectionRequest,
	type PluginEntitySaveOutcome,
	type PluginStorageOutcome,
	type PluginStorageRequest,
	type PluginDeviceRequest,
	type PluginDeviceOutcome,
	type PluginIosLiveActivityRequest,
	type PluginIosLiveActivityOutcome,
	type PickEntityOutcome,
	type AddToCollectionOutcome,
	type AddToCollectionRequest,
	type EditCollectionOutcome,
	type EditCollectionRequest,
} from "@ryot-app/plugin-client-contract";
import type { EntityWatchSubscription } from "@ryot-app/plugin-client-sdk";
import { Cause, Effect, Fiber, Match, Option, Result, Schema } from "effect";

import type { WatchEntities } from "#/modules/entity-watches/service";
import type { PageScreenReadiness } from "#/modules/shell/page-presentation";

const HANDSHAKE_TIMEOUT_MS = 15_000;
const OVERLAY_DISMISS_TIMEOUT_MS = 1_000;

type PluginBridgeTarget = {
	readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
};

export type PluginBridgeViewportInsets = Omit<PluginBridgeViewport, "type">;
export type PluginBridgeNavigationState = Omit<PluginBridgeLocation, "type">;

export type PluginBridgeSession = {
	readonly requestFlush: () => Effect.Effect<boolean>;
	readonly close: () => void;
	readonly sendPageRefresh: () => void;
	readonly requestOverlayDismiss: () => boolean;
	readonly sendTheme: (theme: PluginThemeSnapshot) => void;
	readonly sendShortcut: (shortcut: PageShortcutKey) => void;
	readonly sendViewport: (insets: PluginBridgeViewportInsets) => void;
	readonly sendLocation: (navigation: PluginBridgeNavigationState) => void;
	readonly sendDocument: (
		documentKey: string,
		page: ClientPageContext,
		navigation: PluginBridgeNavigationState,
	) => void;
};

type PluginBridgeState = "ready" | "active" | "closing" | "failed" | "disposed";

type HostScreenType = "add-to-collection-screen" | "edit-collection-screen" | "pick-entity-screen";

type PendingRequest = {
	readonly fiber: Fiber.Fiber<unknown, unknown>;
	readonly type:
		| HostScreenType
		| "device"
		| "asset"
		| "collection"
		| "entity-editor-save"
		| "external-link"
		| "ios-live-activity"
		| "operation"
		| "ryotql"
		| "storage"
		| "upload";
};

const hostScreenTypes: ReadonlySet<PendingRequest["type"]> = new Set<HostScreenType>([
	"pick-entity-screen",
	"edit-collection-screen",
	"add-to-collection-screen",
]);

type PluginBridgeOptions = {
	readonly onDevice: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceOutcome>;
	readonly onIosLiveActivity: (
		request: PluginIosLiveActivityRequest,
	) => Effect.Effect<PluginIosLiveActivityOutcome>;
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly compositionHash: string;
	readonly onFailure: () => void;
	readonly page?: ClientPageContext;
	readonly documentKey: string;
	readonly onOpenDrawer: () => void;
	readonly theme: PluginThemeSnapshot;
	readonly target: PluginBridgeTarget;
	readonly onNavigateBack: () => void;
	readonly watchEntities: WatchEntities;
	readonly viewport: PluginBridgeViewportInsets;
	readonly navigation: PluginBridgeNavigationState;
	readonly onOverlayState: (count: number) => void;
	readonly onHeader: (request: PluginBridgeHeader) => void;
	readonly onNavigate: (request: PluginBridgeNavigate) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onScreenState: (state: PageScreenReadiness) => void;
	readonly onPageSearch: (request: PluginBridgePageSearch) => void;
	readonly onPageShortcuts: (shortcuts: readonly PageShortcutKey[]) => void;
	readonly scheduleOverlayDismissTimeout?: (onTimeout: () => void) => () => void;
	readonly onPickEntity: (
		request: PluginBridgePickEntityScreen,
	) => Effect.Effect<PickEntityOutcome>;
	readonly onEditCollection: (
		request: EditCollectionRequest,
	) => Effect.Effect<EditCollectionOutcome>;
	readonly onAddToCollection: (
		request: AddToCollectionRequest,
	) => Effect.Effect<AddToCollectionOutcome>;
	readonly onAssets: (request: PluginAssetRequest) => Effect.Effect<PluginAssetOutcome>;
	readonly onRyotQL: (request: PluginRyotQLRequest) => Effect.Effect<PluginRyotQLOutcome>;
	readonly onOperation: (request: PluginOperationRequest) => Effect.Effect<PluginOperationOutcome>;
	readonly onCollection: (
		request: PluginCollectionRequest,
	) => Effect.Effect<PluginCollectionOutcome>;
	readonly onEntitySave: (
		request: EntityEditorSaveRequest,
	) => Effect.Effect<PluginEntitySaveOutcome>;
	readonly onUpload: (request: PluginUploadRequest) => Effect.Effect<PluginUploadOutcome>;
	readonly onExternalLink: (request: ExternalLinkRequest) => Effect.Effect<ExternalLinkOutcome>;
	readonly onStorage: (request: PluginStorageRequest) => Effect.Effect<PluginStorageOutcome>;
	readonly onDiagnostic?: (diagnostic: {
		readonly type: PendingRequest["type"];
		readonly requestId: string;
		readonly cause: unknown;
	}) => void;
};

const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
const decodeHostMessage = Schema.decodeUnknownResult(PluginBridgeHostMessage);
const encodeHostMessage = Schema.encodeResult(PluginBridgeHostMessage);
const decodeClientMessage = Schema.decodeUnknownResult(PluginBridgeClientMessage);
const decodeLifecycleClose = Schema.decodeUnknownResult(PluginBridgeLifecycleClose);
const decodeExternalLinkEnvelope = Schema.decodeUnknownResult(
	strictStruct({
		url: Schema.Unknown,
		requestId: Schema.String,
		type: Schema.Literal("external-link-request"),
	}),
);

const isExpectedReady = (ready: PluginBridgeReady, init: PluginBridgeInit) =>
	ready.sessionId === init.sessionId && ready.compositionHash === init.compositionHash;

export function openPluginBridge(options: PluginBridgeOptions): PluginBridgeSession {
	const init: PluginBridgeInit = {
		sessionId: crypto.randomUUID(),
		apiVersion: CLIENT_API_VERSION,
		format: CLIENT_ARTIFACT_FORMAT,
		mode: options.theme.resolvedMode,
		compositionHash: options.compositionHash,
		compilerVersion: CLIENT_COMPILER_VERSION,
		safeAreaTop: options.viewport.safeAreaTop,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		safeAreaBottom: options.viewport.safeAreaBottom,
		...(options.page === undefined ? {} : { page: options.page }),
		documentKey: options.documentKey,
	};

	let viewport = options.viewport;
	let navigation = options.navigation;
	let pendingDocument: { readonly key: string; readonly page: ClientPageContext } | undefined;
	let mode = options.theme.resolvedMode;
	let interestIds = new Set<string>();
	const channel = new MessageChannel();
	let state: PluginBridgeState = "ready";
	const listeners = new AbortController();
	const pending = new Map<string, PendingRequest>();
	const flushes = new Map<string, (flushed: boolean) => void>();
	let nextFlushId = 0;
	let needsFlush = false;
	let interest: EntityWatchSubscription | undefined;
	let overlayCount = 0;
	let nextOverlayRequestId = 0;
	let overlayDismiss:
		| { readonly requestId: string; readonly cancelTimeout: () => void }
		| undefined;
	const timer = window.setTimeout(() => fail(), options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);

	function finish(next: "failed" | "disposed", notify: boolean) {
		if (state === "closing" || state === "failed" || state === "disposed") {
			return;
		}
		state = "closing";
		for (const complete of flushes.values()) {
			complete(false);
		}
		flushes.clear();
		try {
			interest?.dispose();
		} catch {
			/* Interest transport is best effort. */
		}
		interest = undefined;
		interestIds.clear();
		clearTimeout(timer);
		if (overlayDismiss !== undefined) {
			overlayDismiss.cancelTimeout();
			overlayDismiss = undefined;
		}
		overlayCount = 0;
		options.onOverlayState(0);
		if (notify) {
			try {
				channel.port1.postMessage({ reason: next, type: "lifecycle-close" });
			} catch {
				// The transport is already unavailable.
			}
		}
		listeners.abort();
		for (const { fiber } of pending.values()) {
			Effect.runFork(Fiber.interrupt(fiber));
		}
		pending.clear();
		channel.port1.close();
		state = next;
	}

	function close() {
		finish("disposed", true);
	}

	function fail(notify = true) {
		if (state === "closing" || state === "failed" || state === "disposed") {
			return;
		}
		finish("failed", notify);
		options.onFailure();
	}

	function post(message: unknown) {
		try {
			channel.port1.postMessage(message);
		} catch {
			fail();
		}
	}

	function sendTheme(next: PluginThemeSnapshot) {
		mode = next.resolvedMode;
		if (state !== "active") {
			return;
		}
		post({ mode, type: "theme" } satisfies PluginBridgeTheme);
	}

	function sendViewport(next: PluginBridgeViewportInsets) {
		if (
			viewport.safeAreaTop === next.safeAreaTop &&
			viewport.safeAreaBottom === next.safeAreaBottom
		) {
			return;
		}
		viewport = next;
		if (state !== "active") {
			return;
		}
		post({ ...viewport, type: "viewport" } satisfies PluginBridgeViewport);
	}

	function sendLocation(next: PluginBridgeNavigationState) {
		navigation = next;
		if (state !== "active") {
			return;
		}
		post({ ...navigation, type: "location" } satisfies PluginBridgeLocation);
	}

	function sendDocument(
		documentKey: string,
		page: ClientPageContext,
		next: PluginBridgeNavigationState,
	) {
		navigation = next;
		pendingDocument = { page, key: documentKey };
		if (state !== "active") {
			return;
		}
		interest?.dispose();
		interest = undefined;
		interestIds.clear();
		for (const { fiber } of pending.values()) {
			Effect.runFork(Fiber.interrupt(fiber));
		}
		pending.clear();
		overlayDismiss?.cancelTimeout();
		overlayDismiss = undefined;
		overlayCount = 0;
		options.onOverlayState(0);
		options.onPageShortcuts([]);
		post({
			page,
			documentKey,
			type: "document",
			navigation: { ...next, type: "location" },
		} satisfies PluginBridgeDocument);
		pendingDocument = undefined;
	}

	function sendPageRefresh() {
		if (state === "active") {
			post({ type: "page-refresh" } satisfies PluginBridgePageRefresh);
		}
	}
	function requestFlush(): Effect.Effect<boolean> {
		return Effect.callback<boolean>((resume) => {
			if (!needsFlush) {
				resume(Effect.succeed(true));
				return Effect.void;
			}
			if (state !== "active") {
				resume(Effect.succeed(false));
				return Effect.void;
			}
			const requestId = `flush-${++nextFlushId}`;
			flushes.set(requestId, (flushed) => {
				resume(Effect.succeed(flushed));
			});
			post({ requestId, type: "flush-request" });
			return Effect.sync(() => {
				flushes.delete(requestId);
			});
		}).pipe(Effect.timeoutOption("5 seconds"), Effect.map(Option.getOrElse(() => false)));
	}

	function sendShortcut(shortcut: PageShortcutKey) {
		if (state === "active") {
			post({ shortcut, type: "page-shortcut-press" } satisfies PluginBridgePageShortcutPress);
		}
	}

	function requestOverlayDismiss() {
		if (overlayDismiss !== undefined) {
			return true;
		}
		if (state !== "active" || overlayCount === 0) {
			return false;
		}
		nextOverlayRequestId += 1;
		const requestId = `overlay-${nextOverlayRequestId}`;
		const cancelTimeout =
			options.scheduleOverlayDismissTimeout?.(() => fail()) ??
			(() => {
				const dismissTimer = window.setTimeout(() => fail(), OVERLAY_DISMISS_TIMEOUT_MS);
				return () => window.clearTimeout(dismissTimer);
			})();
		overlayDismiss = { requestId, cancelTimeout };
		post({ requestId, type: "dismiss-overlay" } satisfies PluginBridgeDismissOverlay);
		return true;
	}

	function handleOverlayState(request: PluginBridgeOverlayState) {
		overlayCount = request.count;
		options.onOverlayState(request.count);
	}

	function handleOverlayDismissResult(result: PluginBridgeDismissOverlayResult) {
		if (overlayDismiss?.requestId !== result.requestId) {
			return;
		}
		overlayDismiss.cancelTimeout();
		overlayDismiss = undefined;
		if (result.dismissed && overlayCount > 0) {
			overlayCount -= 1;
			options.onOverlayState(overlayCount);
		}
	}

	function handleLifecycleClose(reason: "disposed" | "failed") {
		if (reason === "failed") {
			fail(false);
		} else {
			finish("disposed", false);
			options.onFailure();
		}
	}

	function reportDiagnostic(type: PendingRequest["type"], requestId: string, cause: unknown) {
		if (options.onDiagnostic) {
			options.onDiagnostic({ type, cause, requestId });
		} else {
			console.error("Plugin bridge request failed", type, requestId, cause);
		}
	}

	function outgoingResult(type: PendingRequest["type"], requestId: string, outcome: object) {
		const failure = "outcome" in outcome && outcome.outcome === "failure";
		const message = failure
			? {
					requestId,
					outcome: "failure",
					type: `${type}-result`,
					reason: "reason" in outcome ? outcome.reason : undefined,
				}
			: { ...outcome, requestId, type: `${type}-result` };
		let decoded = decodeHostMessage(message);
		if (Result.isFailure(decoded)) {
			reportDiagnostic(type, requestId, decoded.failure);
			let reason: string;
			if (type === "external-link") {
				reason = "link-open-failed";
			} else if (failure || type === "storage" || type === "ryotql") {
				reason = "transport";
			} else {
				reason = "malformed-result";
			}
			decoded = decodeHostMessage({
				reason,
				requestId,
				outcome: "failure",
				type: `${type}-result`,
			});
		}
		if (Result.isFailure(decoded)) {
			throw new Error("Invalid bridge failure outcome");
		}
		const encoded = encodeHostMessage(decoded.success);
		if (Result.isFailure(encoded)) {
			throw new Error("Invalid encoded bridge outcome");
		}
		return encoded.success;
	}

	function runRequest<Outcome extends object>(
		requestId: string,
		type: PendingRequest["type"],
		operation: () => Effect.Effect<Outcome>,
	) {
		const failure = {
			outcome: "failure",
			reason: type === "external-link" ? "link-open-failed" : "transport",
		};
		if (pending.has(requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const fiber = Effect.runFork(
			(type === "external-link" ? Effect.void : Effect.yieldNow).pipe(
				Effect.flatMap(() => operation()),
				Effect.catchCause((cause) =>
					Cause.hasInterrupts(cause)
						? Effect.interrupt
						: Effect.sync(() => {
								reportDiagnostic(type, requestId, cause);
								return failure;
							}),
				),
				Effect.tap(() => (type === "external-link" ? Effect.yieldNow : Effect.void)),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (state !== "active" || pending.get(requestId)?.fiber !== fiber) {
							return;
						}
						try {
							let message;
							try {
								message = outgoingResult(type, requestId, outcome);
							} catch (cause) {
								reportDiagnostic(type, requestId, cause);
								message = outgoingResult(type, requestId, failure);
							}
							channel.port1.postMessage(message);
							pending.delete(requestId);
						} catch {
							fail();
						}
					}),
				),
			),
		);
		pending.set(requestId, { type, fiber });
	}

	function handleOperation(request: PluginBridgeOperationRequest) {
		runRequest(request.requestId, "operation", () =>
			options.onOperation({
				input: request.input,
				packageId: request.packageId,
				operationSlug: request.operationSlug,
			}),
		);
	}

	function handleStorage(request: PluginBridgeStorageRequest) {
		const capabilityRequest: PluginStorageRequest =
			request.action === "set"
				? {
						key: request.key,
						value: request.value,
						action: request.action,
						pluginId: request.pluginId,
					}
				: { key: request.key, action: request.action, pluginId: request.pluginId };
		runRequest(request.requestId, "storage", () => options.onStorage(capabilityRequest));
	}

	function handleCollection(request: PluginBridgeCollectionRequest) {
		let capabilityRequest: PluginCollectionRequest;
		if (request.action === "create") {
			capabilityRequest = { action: "create", input: request.input };
		} else if (request.action === "upsert-membership") {
			capabilityRequest = { input: request.input, action: "upsert-membership" };
		} else {
			capabilityRequest = { input: request.input, action: "remove-membership" };
		}
		runRequest(request.requestId, "collection", () => options.onCollection(capabilityRequest));
	}

	function handleEntitySave(request: PluginBridgeEntitySaveRequest) {
		const { requestId, type: _type, ...capabilityRequest }: PluginBridgeEntitySaveRequest = request;
		runRequest(requestId, "entity-editor-save", () => options.onEntitySave(capabilityRequest));
	}

	function handleUpload(request: PluginBridgeUploadRequest) {
		const { requestId, type: _type, ...capabilityRequest }: PluginBridgeUploadRequest = request;
		runRequest(requestId, "upload", () => options.onUpload(capabilityRequest));
	}

	function handleAssets(request: PluginBridgeAssetRequest) {
		runRequest(request.requestId, "asset", () => options.onAssets({ assets: request.assets }));
	}

	function handleRyotQL(request: PluginBridgeRyotQLRequest) {
		runRequest(request.requestId, "ryotql", () => options.onRyotQL({ document: request.document }));
	}

	function handleRyotQLCancel(request: PluginBridgeRyotQLCancel) {
		const current = pending.get(request.requestId);
		if (current?.type !== "ryotql" || !pending.delete(request.requestId)) {
			return;
		}
		Effect.runFork(Fiber.interrupt(current.fiber));
	}

	function handleAssetCancel(request: PluginBridgeAssetCancel) {
		const current = pending.get(request.requestId);
		if (current?.type !== "asset" || !pending.delete(request.requestId)) {
			return;
		}
		Effect.runFork(Fiber.interrupt(current.fiber));
	}

	function openHostScreen(
		requestId: string,
		type: HostScreenType,
		open: () => Effect.Effect<{ readonly kind: string }>,
	) {
		const busy = [...pending.values()].some((request) => hostScreenTypes.has(request.type));
		runRequest(requestId, type, () =>
			(busy ? Effect.succeed({ kind: "cancelled" }) : open()).pipe(
				Effect.map((value) => ({ value, outcome: "success" })),
			),
		);
	}

	function handleHostScreenCancel(type: HostScreenType, requestId: string) {
		const current = pending.get(requestId);
		if (current?.type !== type || !pending.delete(requestId)) {
			return;
		}
		Effect.runFork(Fiber.interrupt(current.fiber));
	}

	channel.port1.addEventListener(
		"message",
		(event) => {
			if (state === "active") {
				const decoded = decodeClientMessage(event.data);
				if (Result.isFailure(decoded)) {
					const externalLink = decodeExternalLinkEnvelope(event.data);
					if (Result.isSuccess(externalLink)) {
						runRequest(externalLink.success.requestId, "external-link", () =>
							Effect.succeed({ outcome: "failure", reason: "invalid-request" }),
						);
						return;
					}
					fail();
					return;
				}
				Match.value(decoded.success)
					.pipe(
						Match.when({ type: "persistence-state" }, ({ enabled }) => {
							needsFlush = enabled;
						}),
						Match.when({ type: "flush-result" }, ({ flushed, requestId }) => {
							const complete = flushes.get(requestId);
							flushes.delete(requestId);
							complete?.(flushed);
						}),
						Match.when({ type: "device-request" }, ({ requestId, type: _type, ...request }) =>
							runRequest(requestId, "device", (): Effect.Effect<PluginDeviceOutcome> =>
								options.onDevice(request),
							),
						),
						Match.when(
							{ type: "ios-live-activity-request" },
							({ requestId, type: _type, ...request }) =>
								runRequest(
									requestId,
									"ios-live-activity",
									(): Effect.Effect<PluginIosLiveActivityOutcome> =>
										options.onIosLiveActivity(request),
								),
						),
						Match.when({ type: "entity-watches" }, ({ visible, foreground }) => {
							const declaration = { visible, foreground };
							interestIds = new Set([...declaration.foreground, ...declaration.visible]);
							try {
								if (interest) {
									interest.update(declaration);
								} else {
									interest = options.watchEntities(declaration, (update) => {
										if (state === "active" && interestIds.has(update.entityId)) {
											post({ ...update, type: "entity-updated" });
										}
									});
								}
							} catch {
								/* Interest transport must not fail the document. */
							}
						}),
						Match.when({ type: "asset-cancel" }, (request) => handleAssetCancel(request)),
						Match.when({ type: "pick-entity-screen-cancel" }, ({ requestId }) =>
							handleHostScreenCancel("pick-entity-screen", requestId),
						),
						Match.when({ type: "edit-collection-screen-cancel" }, ({ requestId }) =>
							handleHostScreenCancel("edit-collection-screen", requestId),
						),
						Match.when({ type: "add-to-collection-screen-cancel" }, ({ requestId }) =>
							handleHostScreenCancel("add-to-collection-screen", requestId),
						),
						Match.when({ type: "asset-request" }, (request) => handleAssets(request)),
						Match.when({ type: "navigate-back" }, () => {
							if (!requestOverlayDismiss()) {
								options.onNavigateBack();
							}
						}),
						Match.when({ type: "overlay-state" }, (request) => handleOverlayState(request)),
						Match.when({ type: "dismiss-overlay-result" }, (result) =>
							handleOverlayDismissResult(result),
						),
						Match.when({ type: "open-drawer" }, () => options.onOpenDrawer()),
						Match.when({ type: "kernel-shortcut" }, ({ shortcut }) =>
							options.onKernelShortcut(shortcut),
						),
						Match.when({ type: "page-shortcuts" }, ({ shortcuts }) =>
							options.onPageShortcuts([...new Set(shortcuts.filter(isPageShortcut))].sort()),
						),
						Match.when({ type: "screen-state" }, ({ key, index, hasPreviousScreen }) => {
							if (index === navigation.index && key === navigation.key) {
								options.onScreenState({ key, index, hasPreviousScreen });
							}
						}),
					)
					.pipe(
						Match.when({ type: "header" }, (request) => options.onHeader(request)),
						Match.when({ type: "navigate" }, (request) => options.onNavigate(request)),
						Match.when({ type: "page-search" }, (request) => options.onPageSearch(request)),
						Match.when({ type: "pick-entity-screen" }, (request) =>
							openHostScreen(request.requestId, "pick-entity-screen", () =>
								options.onPickEntity(request),
							),
						),
						Match.when(
							{ type: "edit-collection-screen" },
							({ requestId, type: _type, ...request }) =>
								openHostScreen(requestId, "edit-collection-screen", () =>
									options.onEditCollection(request),
								),
						),
						Match.when(
							{ type: "add-to-collection-screen" },
							({ requestId, type: _type, ...request }) =>
								openHostScreen(requestId, "add-to-collection-screen", () =>
									options.onAddToCollection(request),
								),
						),
						Match.when({ type: "lifecycle-close" }, ({ reason }) => handleLifecycleClose(reason)),
						Match.when({ type: "ryotql-cancel" }, (request) => handleRyotQLCancel(request)),
						Match.when({ type: "ryotql-request" }, (request) => handleRyotQL(request)),
						Match.when({ type: "operation-request" }, (request) => handleOperation(request)),
						Match.when({ type: "collection-request" }, (request) => handleCollection(request)),
						Match.when({ type: "entity-editor-save-request" }, (request) =>
							handleEntitySave(request),
						),
						Match.when({ type: "upload-request" }, (request) => handleUpload(request)),
						Match.when({ type: "external-link-request" }, (request) =>
							runRequest(request.requestId, "external-link", () =>
								options.onExternalLink({ url: request.url }),
							),
						),
						Match.when({ type: "storage-request" }, (request) => handleStorage(request)),
						Match.exhaustive,
					);
				return;
			}
			const lifecycleClose = decodeLifecycleClose(event.data);
			if (Result.isSuccess(lifecycleClose)) {
				handleLifecycleClose(lifecycleClose.success.reason);
				return;
			}
			const decoded = decodeReady(event.data);
			if (Result.isFailure(decoded) || !isExpectedReady(decoded.success, init)) {
				fail();
				return;
			}
			state = "active";
			clearTimeout(timer);
			if (pendingDocument) {
				const { key, page } = pendingDocument;
				pendingDocument = undefined;
				post({
					page,
					documentKey: key,
					type: "document",
					navigation: { ...navigation, type: "location" },
				} satisfies PluginBridgeDocument);
			} else {
				post({ ...navigation, type: "location" } satisfies PluginBridgeLocation);
			}
			if (mode !== init.mode) {
				post({ mode, type: "theme" } satisfies PluginBridgeTheme);
			}
			if (
				viewport.safeAreaTop !== init.safeAreaTop ||
				viewport.safeAreaBottom !== init.safeAreaBottom
			) {
				post({ ...viewport, type: "viewport" } satisfies PluginBridgeViewport);
			}
			options.onReady();
		},
		{ signal: listeners.signal },
	);
	channel.port1.addEventListener("messageerror", () => fail(), { signal: listeners.signal });
	channel.port1.start();
	try {
		options.target.postMessage(init, "*", [channel.port2]);
	} catch {
		channel.port2.close();
		fail(false);
	}

	return {
		close,
		sendTheme,
		requestFlush,
		sendShortcut,
		sendLocation,
		sendDocument,
		sendViewport,
		sendPageRefresh,
		requestOverlayDismiss,
	};
}
