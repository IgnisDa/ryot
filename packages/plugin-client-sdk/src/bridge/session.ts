import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import { MAX_INTEREST_ENTITY_IDS } from "@ryot-app/contract/modules/entity-watches/messages";
import {
	EntitySchemaReference,
	SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntityId, type PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	type AddToCollectionRequest,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	type ClientCompositionMetadata,
	type ClientPageContext,
	type EditCollectionRequest,
	type EntityWatch,
	type KernelShortcut,
	PLUGIN_HEADER_TITLE_MAX,
	type PluginBridgeAddToCollectionScreen,
	type PluginBridgeAddToCollectionScreenCancel,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeBackgroundOperationRequest,
	type PluginBridgeBackgroundOperationSettled,
	type PluginBridgeCalendarSourceVisibilityRequest,
	type PluginBridgeCollectionRequest,
	type PluginBridgeDismissOverlayResult,
	type PluginBridgeEditCollectionScreen,
	type PluginBridgeEditCollectionScreenCancel,
	type PluginBridgeEnrichmentRequest,
	type PluginBridgeEntitySaveRequest,
	type PluginBridgeHeader,
	PluginBridgeHostMessage,
	type PluginBridgeInit,
	type PluginBridgeKernelShortcut,
	type PluginBridgeLocation,
	type PluginBridgeNavigate,
	type PluginBridgeNavigateBack,
	type PluginBridgeOpenDrawer,
	type PluginBridgeOperationRequest,
	type PluginBridgeOverlayState,
	type PluginBridgePageSearch,
	type PluginBridgePageShortcuts,
	type PluginBridgePickEntityScreen,
	type PluginBridgePickEntityScreenCancel,
	type PluginBridgeReady,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeScreenState,
	type PluginBridgeStorageRequest,
	type PluginBridgeUploadRequest,
	type PluginBridgeUserSettingsRequest,
	type PluginCalendarSourceVisibilityRequest,
	type PluginDeviceRequest,
	type PluginEnrichmentRequest,
	type PluginIosLiveActivityRequest,
	type PluginThemeSnapshot,
	type PluginUploadRequest,
	type RyotClientErrorReason,
} from "@ryot-app/plugin-client-contract";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Match, Result, Schema } from "effect";

import type {
	BackgroundOperationAdapterRequest,
	CollectionAdapterRequest,
	EntityUpdate,
	OperationAdapterRequest,
	RyotPageSearchUpdate,
	RyotPickEntityRequest,
	StorageAdapterRequest,
} from "../client/adapter";
import { createRyotClient } from "../client/client";
import { RyotClientError } from "../client/errors";
import type { RyotNavigationTarget } from "../client/navigation-target";
import type { PluginNavigationController, PluginNavigationSnapshot } from "../navigation/store";

type PluginRuntimeState = "ready" | "active" | "closing" | "failed" | "disposed";

type RequestType =
	| "device"
	| "ios-live-activity"
	| "add-to-collection-screen"
	| "asset"
	| "background-operation"
	| "calendar-source-visibility"
	| "collection"
	| "edit-collection-screen"
	| "entity-editor-save"
	| "external-link"
	| "operation"
	| "pick-entity-screen"
	| "enrichment"
	| "ryotql"
	| "storage"
	| "upload"
	| "user-settings";

type PendingCall = {
	readonly type: RequestType;
	readonly complete: (result: Effect.Effect<unknown, RyotClientError>) => void;
};

type PluginThemeRoot = { readonly setAttribute: (name: string, value: string) => void };

const decodeHostMessage = Schema.decodeUnknownResult(PluginBridgeHostMessage);
const noOverlayToDismiss = () => false;

const normalizeHeaderTitle = (title: string) => {
	const trimmed = title.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return trimmed.length > PLUGIN_HEADER_TITLE_MAX
		? trimmed.slice(0, PLUGIN_HEADER_TITLE_MAX)
		: trimmed;
};

type PluginCodeContributor = Extract<
	ClientPageContext["contributors"][number],
	{ readonly kind: "plugin" }
>;

export const createPluginRuntime = (
	port: MessagePort,
	init: PluginBridgeInit,
	metadata: ClientCompositionMetadata,
	root: PluginThemeRoot,
	navigationStore: PluginNavigationController,
	onActive?: () => void,
	onTerminal?: () => void,
	onDocument?: (documentKey: string, page: ClientPageContext | undefined) => void,
) => {
	let hasLocation = false;
	let contributors = init.page?.contributors ?? [];
	const pluginContributors = () =>
		contributors.filter(
			(contributor): contributor is PluginCodeContributor => contributor.kind === "plugin",
		);
	let theme: PluginThemeSnapshot = { resolvedMode: init.mode };
	let nextRequestId = 0;
	let state: PluginRuntimeState = "ready";
	let terminalReason: RyotClientErrorReason | undefined;
	let dismissOverlay = noOverlayToDismiss;
	let overlayCount = 0;
	const flushHandlers = new Set<() => Effect.Effect<void, RyotClientError>>();
	const listeners = new AbortController();
	const navigation = {
		subscribe: navigationStore.subscribe,
		getSnapshot: navigationStore.getSnapshot,
		completeTransition: navigationStore.completeTransition,
		back: () => post({ type: "navigate-back" } satisfies PluginBridgeNavigateBack),
		openDrawer: () => post({ type: "open-drawer" } satisfies PluginBridgeOpenDrawer),
		publishTitle: (title: string | null) => {
			const entry = navigationStore.getSnapshot().entry;
			if (entry === undefined) {
				return;
			}
			const published = title === null ? null : normalizeHeaderTitle(title);
			post({
				key: entry.key,
				type: "header",
				index: entry.index,
				header: published === null ? null : { title: published },
			} satisfies PluginBridgeHeader);
		},
		registerShortcut: (shortcut: string, press: () => void) => {
			const handlers = pageShortcuts.get(shortcut) ?? new Set<() => void>();
			if (!pageShortcuts.has(shortcut)) {
				pageShortcuts.set(shortcut, handlers);
				handlers.add(press);
				publishPageShortcuts();
			} else {
				handlers.add(press);
			}
			return () => {
				if (!handlers.delete(press) || handlers.size > 0) {
					return;
				}
				pageShortcuts.delete(shortcut);
				publishPageShortcuts();
			};
		},
	};
	const pageShortcuts = new Map<string, Set<() => void>>();
	const publishPageShortcuts = () => {
		if (state === "active") {
			post({
				type: "page-shortcuts",
				shortcuts: [...pageShortcuts.keys()].sort(),
			} satisfies PluginBridgePageShortcuts);
		}
	};
	const applyThemeMode = (mode: PluginThemeSnapshot["resolvedMode"]) =>
		root.setAttribute("data-theme", mode);
	const themeListeners = new Set<() => void>();
	const backgroundListeners = new Set<
		(settlement: PluginBridgeBackgroundOperationSettled) => void
	>();
	const pending = new Map<string, PendingCall>();
	const interestOwners = new Set<{
		interest: EntityWatch;
		onUpdate: (update: EntityUpdate) => void;
	}>();
	let postedInterest = JSON.stringify({ visible: [], foreground: [] });
	const publishInterest = () => {
		const roots = new Set([...interestOwners].flatMap(({ interest }) => interest.foreground));
		const foreground = [...roots].sort().slice(0, MAX_INTEREST_ENTITY_IDS);
		const visible = [...new Set([...interestOwners].flatMap(({ interest }) => interest.visible))]
			.filter((id) => !roots.has(id))
			.sort()
			.slice(0, MAX_INTEREST_ENTITY_IDS - foreground.length);
		const serialized = JSON.stringify({ visible, foreground });
		if (serialized === postedInterest) {
			return;
		}
		if (!post({ visible, foreground, type: "entity-watches" })) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		postedInterest = serialized;
	};

	const activate = () => {
		if (state === "ready" && hasLocation) {
			state = "active";
			onActive?.();
		}
	};

	const rejectPending = (reason: RyotClientErrorReason) => {
		const pendingCalls = [...pending.values()];
		pending.clear();
		for (const call of pendingCalls) {
			call.complete(Effect.fail(new RyotClientError(reason)));
		}
	};
	const resetDocument = () => {
		flushHandlers.clear();
		post({ enabled: false, type: "persistence-state" });
		rejectPending("disposed");
		pageShortcuts.clear();
		publishPageShortcuts();
		overlayCount = 0;
		post({ count: 0, type: "overlay-state" } satisfies PluginBridgeOverlayState);
		interestOwners.clear();
		publishInterest();
		navigation.publishTitle(null);
	};

	const finish = (next: "failed" | "disposed", reason: RyotClientErrorReason, notify: boolean) => {
		if (state === "failed" || state === "disposed" || state === "closing") {
			return;
		}
		state = "closing";
		terminalReason = reason;
		flushHandlers.clear();
		rejectPending(reason);
		themeListeners.clear();
		backgroundListeners.clear();
		interestOwners.clear();
		hasLocation = false;
		navigationStore.clear();
		if (notify) {
			try {
				port.postMessage({ reason: next, type: "lifecycle-close" });
			} catch {
				// The transport is already unavailable.
			}
		}
		listeners.abort();
		try {
			port.close();
		} catch {
			// The transport is already unavailable.
		}
		state = next;
		onTerminal?.();
	};

	const post = (message: unknown) => {
		try {
			port.postMessage(message);
			return true;
		} catch {
			finish("failed", "transport", false);
			return false;
		}
	};

	const admit = (requestId: string, call: PendingCall) => {
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			finish("failed", "protocol", true);
			call.complete(Effect.fail(new RyotClientError("protocol")));
			return false;
		}
		pending.set(requestId, call);
		return true;
	};

	const sendRequest = (
		type: RequestType,
		message: (requestId: string) => unknown,
		cancel?: (requestId: string) => unknown,
	): Effect.Effect<unknown, RyotClientError> =>
		Effect.callback<unknown, RyotClientError>((complete) => {
			if (state !== "active") {
				complete(Effect.fail(new RyotClientError(terminalReason ?? "transport")));
				return Effect.void;
			}
			const requestId = `${type}-${++nextRequestId}`;
			if (!admit(requestId, { type, complete })) {
				return Effect.void;
			}
			post(message(requestId));
			return Effect.sync(() => {
				if (pending.delete(requestId) && cancel && state === "active") {
					post(cancel(requestId));
				}
			});
		});

	const query = (document: PreparedRecipe<unknown>["document"]) =>
		sendRequest(
			"ryotql",
			(requestId) =>
				({ document, requestId, type: "ryotql-request" }) satisfies PluginBridgeRyotQLRequest,
			(requestId) => ({ requestId, type: "ryotql-cancel" }) satisfies PluginBridgeRyotQLCancel,
		);

	const resolveAssets = (requested: readonly ManagedAssetLocator[]) =>
		sendRequest(
			"asset",
			(requestId) =>
				({
					requestId,
					type: "asset-request",
					assets: [...requested],
				}) satisfies PluginBridgeAssetRequest,
			(requestId) => ({ requestId, type: "asset-cancel" }) satisfies PluginBridgeAssetCancel,
		);

	const invokeOperation = (operation: OperationAdapterRequest) =>
		sendRequest(
			"operation",
			(requestId) =>
				({
					requestId,
					input: operation.input,
					type: "operation-request",
					operationSlug: operation.slug,
					packageId: PluginPackageId.make(operation.packageId),
					...(operation.idempotencyKey === undefined
						? {}
						: { idempotencyKey: operation.idempotencyKey }),
				}) satisfies PluginBridgeOperationRequest,
		);

	const submitBackground = (submission: BackgroundOperationAdapterRequest) =>
		sendRequest(
			"background-operation",
			(requestId) =>
				({
					requestId,
					input: submission.input,
					label: submission.label,
					operationSlug: submission.slug,
					type: "background-operation-request",
					idempotencyKey: submission.idempotencyKey,
					packageId: PluginPackageId.make(submission.packageId),
				}) satisfies PluginBridgeBackgroundOperationRequest,
		);

	const mutateCollection = (collection: CollectionAdapterRequest) =>
		sendRequest(
			"collection",
			(requestId) =>
				({
					...collection,
					requestId,
					type: "collection-request",
				}) satisfies PluginBridgeCollectionRequest,
		);

	const setCalendarSourceVisibility = (request: PluginCalendarSourceVisibilityRequest) =>
		sendRequest(
			"calendar-source-visibility",
			(requestId) =>
				({
					...request,
					requestId,
					type: "calendar-source-visibility-request",
				}) satisfies PluginBridgeCalendarSourceVisibilityRequest,
		);

	const whenPluginContributor = <A, E, R>(
		pluginId: PluginId,
		send: () => Effect.Effect<A, E, R>,
	) =>
		pluginContributors().some((contributor) => contributor.pluginId === pluginId)
			? send()
			: Effect.fail(new RyotClientError("invalid-request"));

	const saveEntity = (request: EntityEditorSaveRequest) => {
		const owner = request.submission.entitySchema.owner;
		return owner.kind !== "plugin"
			? Effect.fail(new RyotClientError("invalid-request"))
			: whenPluginContributor(owner.pluginId, () =>
					sendRequest(
						"entity-editor-save",
						(requestId) =>
							({
								...request,
								requestId,
								type: "entity-editor-save-request",
							}) satisfies PluginBridgeEntitySaveRequest,
					),
				);
	};

	const accessStorage = (entry: StorageAdapterRequest) =>
		whenPluginContributor(entry.pluginId, () =>
			sendRequest(
				"storage",
				(requestId) =>
					({ ...entry, requestId, type: "storage-request" }) satisfies PluginBridgeStorageRequest,
			),
		);

	const readUserSettings = (pluginId: PluginId) =>
		whenPluginContributor(pluginId, () =>
			sendRequest(
				"user-settings",
				(requestId) =>
					({
						pluginId,
						requestId,
						type: "user-settings-request",
					}) satisfies PluginBridgeUserSettingsRequest,
			),
		);

	const requestEnrichment = (request: PluginEnrichmentRequest) =>
		whenPluginContributor(request.pluginId, () =>
			sendRequest(
				"enrichment",
				(requestId) =>
					({
						...request,
						requestId,
						type: "enrichment-request",
					}) satisfies PluginBridgeEnrichmentRequest,
			),
		);

	const upload = (request: PluginUploadRequest) =>
		sendRequest(
			"upload",
			(requestId) =>
				({ ...request, requestId, type: "upload-request" }) satisfies PluginBridgeUploadRequest,
		);
	const settle = (
		type: RequestType,
		requestId: string,
		outcome:
			| { readonly outcome: "success"; readonly value: unknown }
			| {
					readonly outcome: "failure";
					readonly reason: RyotClientErrorReason;
					readonly message?: string;
			  },
	) => {
		const call = pending.get(requestId);
		if (call?.type !== type || !pending.delete(requestId)) {
			return;
		}
		call.complete(
			outcome.outcome === "failure"
				? Effect.fail(new RyotClientError(outcome.reason, outcome.message))
				: Effect.succeed(outcome.value),
		);
	};

	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		const target = Match.value(to).pipe(
			Match.when({ kind: "plugin-preferences" }, ({ packageId }) => ({
				kind: "plugin-preferences" as const,
				packageId: PluginPackageId.make(packageId),
			})),
			Match.when({ kind: "plugin-route" }, ({ path, search, packageId }) => ({
				path,
				kind: "plugin-route" as const,
				packageId: PluginPackageId.make(packageId),
				search: search === undefined ? "" : new URLSearchParams(search).toString(),
			})),
			Match.when({ kind: "entity" }, ({ entityId }) => ({
				kind: "entity" as const,
				entityId: EntityId.make(entityId),
			})),
			Match.when({ kind: "saved-view" }, ({ reference }) => ({
				kind: "saved-view" as const,
				reference: Schema.decodeSync(SavedViewReference)(reference),
			})),
			Match.when({ kind: "kernel-page" }, ({ page }) => ({ page, kind: "kernel-page" as const })),
			Match.exhaustive,
		);
		if (!post({ mode, target, type: "navigate" } satisfies PluginBridgeNavigate)) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
	};
	const navigatePageSearch = (mode: "push" | "replace", update: RyotPageSearchUpdate) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		if (!post({ mode, update, type: "page-search" } satisfies PluginBridgePageSearch)) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
	};
	const pickEntity = (request: RyotPickEntityRequest) =>
		sendRequest(
			"pick-entity-screen",
			(requestId) =>
				({
					...request,
					requestId,
					type: "pick-entity-screen",
					schema: Schema.decodeSync(EntitySchemaReference)(request.schema),
				}) satisfies PluginBridgePickEntityScreen,
			(requestId) =>
				({
					requestId,
					type: "pick-entity-screen-cancel",
				}) satisfies PluginBridgePickEntityScreenCancel,
		);

	const editCollection = (request: EditCollectionRequest) =>
		sendRequest(
			"edit-collection-screen",
			(requestId) =>
				({
					...request,
					requestId,
					type: "edit-collection-screen",
				}) satisfies PluginBridgeEditCollectionScreen,
			(requestId) =>
				({
					requestId,
					type: "edit-collection-screen-cancel",
				}) satisfies PluginBridgeEditCollectionScreenCancel,
		);
	const addToCollection = (request: AddToCollectionRequest) =>
		sendRequest(
			"add-to-collection-screen",
			(requestId) =>
				({
					...request,
					requestId,
					type: "add-to-collection-screen",
				}) satisfies PluginBridgeAddToCollectionScreen,
			(requestId) =>
				({
					requestId,
					type: "add-to-collection-screen-cancel",
				}) satisfies PluginBridgeAddToCollectionScreenCancel,
		);

	const client = createRyotClient({
		query,
		upload,
		navigate,
		saveEntity,
		pickEntity,
		resolveAssets,
		accessStorage,
		editCollection,
		addToCollection,
		invokeOperation,
		submitBackground,
		readUserSettings,
		mutateCollection,
		requestEnrichment,
		navigatePageSearch,
		setCalendarSourceVisibility,
		device: (request: PluginDeviceRequest) =>
			sendRequest("device", (requestId) => ({ ...request, requestId, type: "device-request" })),
		openExternalLink: (request) =>
			sendRequest("external-link", (requestId) => ({
				...request,
				requestId,
				type: "external-link-request",
			})),
		iosLiveActivity: (request: PluginIosLiveActivityRequest) =>
			sendRequest("ios-live-activity", (requestId) => ({
				...request,
				requestId,
				type: "ios-live-activity-request",
			})),
		overlays: {
			setDismissHandler: (handler) => {
				dismissOverlay = handler;
			},
			setCount: (count) => {
				overlayCount = count;
				if (state === "active") {
					post({ count, type: "overlay-state" } satisfies PluginBridgeOverlayState);
				}
			},
		},
		registerFlush: (flush) => {
			flushHandlers.add(flush);
			post({ enabled: true, type: "persistence-state" });
			return () => {
				flushHandlers.delete(flush);
				if (state === "active") {
					post({ type: "persistence-state", enabled: flushHandlers.size > 0 });
				}
			};
		},
		subscribeBackgroundSettled: (listener) => {
			if (state === "closing" || state === "failed" || state === "disposed") {
				throw new RyotClientError(terminalReason ?? "transport");
			}
			backgroundListeners.add(listener);
			return () => {
				backgroundListeners.delete(listener);
			};
		},
		theme: {
			getSnapshot: () => {
				if (state === "closing" || state === "failed" || state === "disposed") {
					throw new RyotClientError(terminalReason ?? "transport");
				}
				return theme;
			},
			subscribe: (listener) => {
				if (state === "closing" || state === "failed" || state === "disposed") {
					throw new RyotClientError(terminalReason ?? "transport");
				}
				themeListeners.add(listener);
				return () => themeListeners.delete(listener);
			},
		},
		pluginIdentity: (packageId) => {
			if (state === "closing" || state === "failed" || state === "disposed") {
				throw new RyotClientError(terminalReason ?? "disposed");
			}
			const matches = pluginContributors().filter(
				(contributor) => contributor.packageId === packageId,
			);
			const contributor = matches[0];
			if (matches.length !== 1 || contributor === undefined) {
				throw new RyotClientError("invalid-request");
			}
			return { kind: "local", pluginId: contributor.pluginId };
		},
		watchEntities: (interest, onUpdate) => {
			if (state !== "active") {
				throw new RyotClientError(terminalReason ?? "transport");
			}
			const owner = { interest, onUpdate };
			interestOwners.add(owner);
			publishInterest();
			return {
				dispose: () => {
					if (interestOwners.delete(owner)) {
						publishInterest();
					}
				},
				update: (next) => {
					if (state !== "active") {
						throw new RyotClientError(terminalReason ?? "transport");
					}
					owner.interest = next;
					publishInterest();
				},
			};
		},
	});

	const fatal = () => finish("failed", "protocol", true);
	const forwardKernelShortcut = (shortcut: KernelShortcut) => {
		if (state === "active") {
			post({ shortcut, type: "kernel-shortcut" } satisfies PluginBridgeKernelShortcut);
		}
	};
	const acceptLocation = ({
		key,
		index,
		compact,
		leading,
		edgeBack,
		location,
	}: Omit<PluginBridgeLocation, "type">) => {
		let accepted: PluginNavigationSnapshot;
		try {
			accepted = navigationStore.setLocation({
				leading,
				compact,
				edgeBack,
				entry: { key, index, location },
			});
		} catch {
			finish("failed", "protocol", true);
			return;
		}
		if (state !== "ready" && state !== "active") {
			return;
		}
		const acceptedEntry = accepted.entry;
		if (acceptedEntry === undefined) {
			finish("failed", "protocol", true);
			return;
		}
		if (
			!post({
				type: "screen-state",
				key: acceptedEntry.key,
				index: acceptedEntry.index,
				hasPreviousScreen: accepted.screens.length > 1,
			} satisfies PluginBridgeScreenState)
		) {
			return;
		}
		const activating = state === "ready";
		hasLocation = true;
		activate();
		if (activating && overlayCount > 0) {
			post({ count: overlayCount, type: "overlay-state" } satisfies PluginBridgeOverlayState);
		}
	};

	port.addEventListener(
		"message",
		(event) => {
			if (state === "failed" || state === "disposed" || state === "closing") {
				return;
			}
			const decoded = decodeHostMessage(event.data);
			if (Result.isFailure(decoded)) {
				finish("failed", "protocol", true);
				return;
			}
			const message = decoded.success;
			switch (message.type) {
				case "flush-request":
					Effect.runFork(
						Effect.forEach([...flushHandlers], (flush) => flush(), { discard: true }).pipe(
							Effect.matchCause({ onSuccess: () => true, onFailure: () => false }),
							Effect.tap((flushed) =>
								Effect.sync(() => {
									if (state === "active") {
										post({ flushed, type: "flush-result", requestId: message.requestId });
									}
								}),
							),
						),
					);
					return;
				case "device-result":
					settle("device", message.requestId, message);
					return;
				case "ios-live-activity-result":
					settle("ios-live-activity", message.requestId, message);
					return;
				case "document":
					contributors = message.page?.contributors ?? [];
					resetDocument();
					onDocument?.(message.documentKey, message.page);
					acceptLocation(message.navigation);
					return;
				case "dismiss-overlay": {
					let dismissed = false;
					try {
						dismissed = dismissOverlay();
					} catch {
						// A failed overlay callback is acknowledged without taking down the document.
					}
					post({
						dismissed,
						requestId: message.requestId,
						type: "dismiss-overlay-result",
					} satisfies PluginBridgeDismissOverlayResult);
					return;
				}
				case "entity-updated":
					for (const owner of Array.from(interestOwners)) {
						if (
							interestOwners.has(owner) &&
							(owner.interest.foreground.includes(message.entityId) ||
								owner.interest.visible.includes(message.entityId))
						) {
							owner.onUpdate({ reason: message.reason, entityId: message.entityId });
						}
					}
					return;
				case "location":
					acceptLocation(message);
					return;
				case "viewport":
					navigationStore.setViewport({
						safeAreaTop: message.safeAreaTop,
						safeAreaBottom: message.safeAreaBottom,
					});
					return;
				case "theme":
					applyThemeMode(message.mode);
					theme = { resolvedMode: message.mode };
					for (const listener of themeListeners) {
						listener();
					}
					return;
				case "page-refresh":
					client.mutationCompleted.hint();
					return;
				case "page-shortcut-press":
					for (const press of pageShortcuts.get(message.shortcut) ?? []) {
						press();
					}
					return;
				case "lifecycle-close":
					finish(message.reason, message.reason === "disposed" ? "disposed" : "protocol", false);
					return;
				case "operation-result":
					settle(
						"operation",
						message.requestId,
						message.outcome === "failure" ? message : { outcome: "success", value: message.value },
					);
					return;
				case "background-operation-accepted":
					settle(
						"background-operation",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: message.submissionId },
					);
					return;
				case "background-operation-settled":
					for (const listener of backgroundListeners) {
						listener(message);
					}
					return;
				case "pick-entity-screen-result":
					settle("pick-entity-screen", message.requestId, message);
					return;
				case "edit-collection-screen-result":
					settle("edit-collection-screen", message.requestId, message);
					return;
				case "add-to-collection-screen-result":
					settle("add-to-collection-screen", message.requestId, message);
					return;
				case "external-link-result":
					settle(
						"external-link",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: { outcome: "success" } },
					);
					return;
				case "storage-result":
					settle("storage", message.requestId, message);
					return;
				case "user-settings-result":
					settle(
						"user-settings",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: message.settings },
					);
					return;
				case "enrichment-result":
					settle(
						"enrichment",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: { enrichmentRequestId: message.enrichmentRequestId } },
					);
					return;
				case "entity-editor-save-result":
					settle(
						"entity-editor-save",
						message.requestId,
						message.outcome === "failure" ? message : { outcome: "success", value: message.output },
					);
					return;
				case "collection-result":
					settle(
						"collection",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: message.response },
					);
					return;
				case "calendar-source-visibility-result":
					settle(
						"calendar-source-visibility",
						message.requestId,
						message.outcome === "failure" ? message : { value: null, outcome: "success" },
					);
					return;
				case "upload-result": {
					if (message.outcome === "failure") {
						settle("upload", message.requestId, message);
						return;
					}
					const { type: _type, outcome: _outcome, requestId: _requestId, ...value } = message;
					settle("upload", message.requestId, { value, outcome: "success" });
					return;
				}
				case "asset-result":
					settle(
						"asset",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: message.resolutions },
					);
					return;
				case "ryotql-result":
					settle(
						"ryotql",
						message.requestId,
						message.outcome === "failure"
							? message
							: { outcome: "success", value: message.response },
					);
					return;
				default: {
					throw new Error("Unhandled plugin host message", { cause: message satisfies never });
				}
			}
		},
		{ signal: listeners.signal },
	);
	port.addEventListener("messageerror", () => finish("failed", "transport", true), {
		signal: listeners.signal,
	});
	applyThemeMode(init.mode);
	navigationStore.setViewport({
		safeAreaTop: init.safeAreaTop,
		safeAreaBottom: init.safeAreaBottom,
	});

	try {
		port.start();
		post({
			format: metadata.format,
			sessionId: init.sessionId,
			compositionHash: metadata.hash,
			apiVersion: metadata.apiVersion,
			bridgeVersion: metadata.bridgeVersion,
			compilerVersion: metadata.compilerVersion,
		} satisfies PluginBridgeReady);
	} catch {
		finish("failed", "transport", false);
	}

	return {
		fatal,
		client,
		navigation,
		page: init.page,
		forwardKernelShortcut,
		dispose: () => finish("disposed", "disposed", true),
	};
};
