import { describe, expect, it } from "@effect/vitest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	type AddToCollectionOutcome,
	type AddToCollectionRequest,
	CLIENT_BRIDGE_BOOTSTRAP_READY,
	type EditCollectionOutcome,
	type EditCollectionRequest,
	PluginBridgeInit,
	type PluginBridgePickEntityScreen,
	type PluginIosLiveActivityOutcome,
	type PluginLogicalLocation,
	type PluginOperationRequest,
	type PickEntityOutcome,
} from "@ryot-app/plugin-client-contract";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from "effect";
import type { ReactNode } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import type { PluginOperationDispatchOutcome } from "#/modules/pages/bridge/operations";
import { PageIframeHost } from "#/modules/pages/runtime/iframe-host";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { PluginCatalogProvider } from "#/modules/plugins/catalog/provider";
import { PluginCatalogService } from "#/modules/plugins/catalog/service";
import type { ThemeStore } from "#/modules/theme/store";

const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => ({ resolvedMode: "light" }),
};
const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const ryot = createTestRyotClock();
const home: PluginLogicalLocation = { path: "/", kind: "route", search: "keep=1" };
const srcDoc = '<!doctype html><html><body><div id="app"></div></body></html>';

function mount(
	options: {
		readonly onReloadCurrent?: () => void;
		readonly onLoadDocument?: () => Effect.Effect<string, Error>;
		readonly onCheckFreshness?: () => Effect.Effect<boolean, Error>;
		readonly subscribeResume?: (resumed: () => void) => () => void;
		readonly onInvokeOperation?: (
			request: PluginOperationRequest,
		) => Effect.Effect<PluginOperationDispatchOutcome>;
		readonly onPickEntity?: (
			request: PluginBridgePickEntityScreen,
		) => Effect.Effect<PickEntityOutcome>;
	} = {},
) {
	const backInterceptors = createBackInterceptors();
	const catalogRuntime = ManagedRuntime.make(
		Layer.mergeAll(
			makePluginCatalogEventsTestLayer().layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed([]) }),
		),
	);
	const withCatalog = (children: ReactNode) => (
		<RyotProvider runtime={ryot.runtime} hostServices={{ scope, runtime: catalogRuntime }}>
			<PluginCatalogProvider scope={scope} initialCatalog={[]} runtime={catalogRuntime}>
				{children}
			</PluginCatalogProvider>
		</RyotProvider>
	);
	let documentLoads = 0;
	const onLoadDocument = () => {
		documentLoads += 1;
		return options.onLoadDocument?.() ?? Effect.succeed(srcDoc);
	};
	const states: unknown[] = [];
	const searches: unknown[] = [];
	const navigations: unknown[] = [];
	const entityPicks: unknown[] = [];
	let screens: {
		readonly inert?: boolean;
		readonly onEditCollection?: (
			request: EditCollectionRequest,
		) => Effect.Effect<EditCollectionOutcome>;
		readonly onAddToCollection?: (
			request: AddToCollectionRequest,
		) => Effect.Effect<AddToCollectionOutcome>;
	} = {};
	const operations: PluginOperationRequest[] = [];
	const onPickEntity =
		options.onPickEntity ??
		((request: PluginBridgePickEntityScreen) => {
			entityPicks.push(request);
			return Effect.succeed({ kind: "cancelled" as const });
		});
	const refreshListeners = new Set<() => void>();
	const mutationCompleted = {
		hint: () => {
			for (const listener of refreshListeners) {
				listener();
			}
		},
		subscribe: (listener: () => void) => {
			refreshListeners.add(listener);
			return () => {
				refreshListeners.delete(listener);
			};
		},
	};
	const props = (
		location: PluginLogicalLocation,
		index: number,
		freshnessCheckRevision = 0,
		active = true,
		pageKey = "page-1",
		pickEntityHandler = onPickEntity,
	) => ({
		theme,
		active,
		location,
		onLoadDocument,
		title: "Fixture",
		backInterceptors,
		mutationCompleted,
		chromeLeading: null,
		documentKey: pageKey,
		inert: screens.inert,
		freshnessCheckRevision,
		onHeader: () => undefined,
		onFlushReady: () => undefined,
		onOpenDrawer: () => undefined,
		onNavigateBack: () => undefined,
		onOverlayState: () => undefined,
		onPickEntity: pickEntityHandler,
		onKernelShortcut: () => undefined,
		onReleaseResources: () => undefined,
		chromeTriggerRef: { current: null },
		compositionHash: "composition-hash",
		subscribeResume: options.subscribeResume,
		viewport: { safeAreaTop: 7, safeAreaBottom: 11 },
		onScreenState: (state: unknown) => states.push(state),
		onPageSearch: (request: unknown) => searches.push(request),
		onNavigate: (request: unknown) => navigations.push(request),
		onReloadCurrent: options.onReloadCurrent ?? (() => undefined),
		onCheckFreshness: options.onCheckFreshness ?? (() => Effect.succeed(true)),
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		onQuery: () => Effect.succeed({ outcome: "failure" as const, reason: "transport" as const }),
		onAssets: () => Effect.succeed({ outcome: "failure" as const, reason: "transport" as const }),
		onUpload: () => Effect.succeed({ outcome: "failure" as const, reason: "transport" as const }),
		onStorage: () => Effect.succeed({ outcome: "failure" as const, reason: "transport" as const }),
		onCollection: () =>
			Effect.succeed({ outcome: "failure" as const, reason: "transport" as const }),
		onEntitySave: () =>
			Effect.succeed({ outcome: "failure" as const, reason: "transport" as const }),
		onDevice: () =>
			Effect.succeed({ outcome: "failure" as const, reason: "invalid-request" as const }),
		onExternalLink: () =>
			Effect.succeed({ outcome: "failure" as const, reason: "link-open-failed" as const }),
		onEditCollection: (request: EditCollectionRequest) =>
			screens.onEditCollection?.(request) ?? Effect.succeed({ kind: "cancelled" as const }),
		onAddToCollection: (request: AddToCollectionRequest) =>
			screens.onAddToCollection?.(request) ?? Effect.succeed({ kind: "cancelled" as const }),
		onIosLiveActivity: () =>
			Effect.succeed({
				outcome: "success",
				value: { status: "unsupported" },
			} satisfies PluginIosLiveActivityOutcome),
		navigation: {
			index,
			location,
			compact: true,
			key: `k${index}`,
			edgeBack: index > 0,
			leading: index > 0 ? ("back" as const) : ("drawer" as const),
		},
		onInvokeOperation: (request: PluginOperationRequest) => {
			operations.push(request);
			return (
				options.onInvokeOperation?.(request) ??
				Effect.succeed({ value: null, outcome: "success" as const })
			);
		},
		page: {
			view: null,
			settings: {},
			contributors: [],
			dataSources: null,
			route: { params: {} },
			renderer: { name: "fixture", kind: "kernel" as const },
			target: {
				search: "",
				path: pageKey,
				kind: "plugin-route" as const,
				packageId: PluginPackageId.make("test/fixture"),
			},
		},
	});
	const view = render(withCatalog(<PageIframeHost {...props(home, 0)} />));
	return {
		...view,
		states,
		searches,
		operations,
		navigations,
		entityPicks,
		backInterceptors,
		refresh: mutationCompleted.hint,
		documentLoads: () => documentLoads,
		setActive: (active: boolean) =>
			view.rerender(withCatalog(<PageIframeHost {...props(home, 0, 0, active)} />)),
		replace: (pageKey: string) =>
			view.rerender(withCatalog(<PageIframeHost {...props(home, 0, 0, true, pageKey)} />)),
		setScreens: (next: typeof screens) => {
			screens = next;
			view.rerender(withCatalog(<PageIframeHost {...props(home, 0)} />));
		},
		setPickEntityHandler: (handler: typeof onPickEntity) =>
			view.rerender(
				withCatalog(<PageIframeHost {...props(home, 0, 0, true, "page-1", handler)} />),
			),
		move: (location: PluginLogicalLocation, index: number, freshnessCheckRevision = 0) =>
			view.rerender(
				withCatalog(<PageIframeHost {...props(location, index, freshnessCheckRevision)} />),
			),
	};
}

function flush() {
	return act(() =>
		Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.promise(() => Promise.resolve());
				yield* Effect.promise(() => Promise.resolve());
			}),
		),
	);
}

function connect(frame: HTMLIFrameElement) {
	const messages: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let port: MessagePort | undefined;
	Object.defineProperty(frame, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (message: unknown, _origin: string, transfer: Transferable[]) => {
				init = Schema.decodeUnknownSync(PluginBridgeInit)(message);
				const transferred = transfer[0];
				if (!(transferred instanceof MessagePort)) {
					throw new Error("Missing plugin port");
				}
				port = transferred;
				port.addEventListener("message", (event) => messages.push(event.data));
				port.start();
			},
		},
	});
	const readyEvent = new MessageEvent("message", { data: { type: CLIENT_BRIDGE_BOOTSTRAP_READY } });
	Object.defineProperty(readyEvent, "source", { value: frame.contentWindow });
	fireEvent(window, readyEvent);
	if (init === undefined || port === undefined) {
		throw new Error("Bridge did not connect");
	}
	const {
		mode: _mode,
		page: _page,
		safeAreaTop: _top,
		safeAreaBottom: _bottom,
		documentKey: _documentKey,
		...ready
	} = init;
	return { init, port, ready, messages };
}

describe("PageIframeHost", () => {
	it.live("keeps the minimal interstitial visible through document loading and bootstrap", () =>
		Effect.gen(function* () {
			const document = yield* Deferred.make<string, Error>();
			mount({ onLoadDocument: () => Deferred.await(document) });

			expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Opening Fixture");
			expect(screen.getByRole("status").textContent).toContain("Getting your view ready");
			expect(screen.queryByTitle("Fixture plugin")).toBeNull();

			yield* Deferred.succeed(document, srcDoc);
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Opening Fixture");

			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("status")).toBeNull()));
			expect(screen.queryByRole("heading")).toBeNull();
			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		}),
	);

	it.live("uses one document and bridge while location and global history change", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			host.move({ kind: "route", path: "/details", search: "keep=1&tab=stats" }, 1);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(2)));

			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
			expect(bridge.init).toMatchObject({ safeAreaTop: 7, safeAreaBottom: 11 });
			expect(bridge.messages[1]).toMatchObject({
				index: 1,
				key: "k1",
				compact: true,
				edgeBack: true,
				location: { kind: "route", path: "/details", search: "keep=1&tab=stats" },
			});
		}),
	);

	it.live("uses the current route entity-picker callback for a live bridge", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			const routed: PluginBridgePickEntityScreen[] = [];
			host.setPickEntityHandler((request) =>
				Effect.sync(() => routed.push(request)).pipe(Effect.as({ kind: "cancelled" as const })),
			);
			bridge.port.postMessage({
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "movie", owner: { kind: "plugin", pluginId: "media-installation" } },
				library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
			});
			yield* Effect.promise(() => waitFor(() => expect(routed).toHaveLength(1)));

			expect(host.entityPicks).toEqual([]);
			expect(routed[0]).toMatchObject({ requestId: "pick-entity-screen-1" });
		}),
	);

	it.live("routes collection screens to the current callbacks and keeps the frame inert", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			bridge.port.postMessage({ requestId: "edit-1", type: "edit-collection-screen" });
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(2)));
			expect(bridge.messages[1]).toEqual({
				outcome: "success",
				requestId: "edit-1",
				value: { kind: "cancelled" },
				type: "edit-collection-screen-result",
			});

			const edits: EditCollectionRequest[] = [];
			const adds: AddToCollectionRequest[] = [];
			host.setScreens({
				inert: true,
				onAddToCollection: (request) =>
					Effect.sync(() => adds.push(request)).pipe(Effect.as({ kind: "saved" as const })),
				onEditCollection: (request) =>
					Effect.sync(() => edits.push(request)).pipe(Effect.as({ kind: "deleted" as const })),
			});
			expect(frame.hasAttribute("inert")).toBe(true);
			bridge.port.postMessage({
				requestId: "edit-2",
				collectionId: "collection-1",
				type: "edit-collection-screen",
			});
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(3)));
			bridge.port.postMessage({
				requestId: "add-1",
				entityId: "entity-1",
				type: "add-to-collection-screen",
			});
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(4)));

			expect(edits).toEqual([{ collectionId: "collection-1" }]);
			expect(adds).toEqual([{ entityId: "entity-1" }]);
			expect(bridge.messages.slice(2)).toEqual([
				{
					outcome: "success",
					requestId: "edit-2",
					value: { kind: "deleted" },
					type: "edit-collection-screen-result",
				},
				{
					requestId: "add-1",
					outcome: "success",
					value: { kind: "saved" },
					type: "add-to-collection-screen-result",
				},
			]);
			host.setScreens({});
			expect(frame.hasAttribute("inert")).toBe(false);
			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		}),
	);

	it.live("replaces a document without reloading the iframe and clears page-owned state", () =>
		Effect.gen(function* () {
			const host = mount();
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({ count: 1, type: "overlay-state" });
			bridge.port.postMessage({ shortcuts: ["A"], type: "page-shortcuts" });
			yield* Effect.promise(() => waitFor(() => expect(host.backInterceptors.run()).toBe(true)));
			host.replace("page-2");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							documentKey: "page-2",
							page: expect.objectContaining({
								target: expect.objectContaining({ path: "page-2" }),
							}),
						}),
					),
				),
			);
			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
			expect(host.backInterceptors.run()).toBe(false);
		}),
	);

	it.live("loads the document once into a sandboxed srcdoc frame", () =>
		Effect.gen(function* () {
			const host = mount();
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			expect(frame.getAttribute("srcdoc")).toBe(srcDoc);
			expect(frame.hasAttribute("src")).toBe(false);
			expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
			expect(host.documentLoads()).toBe(1);
		}),
	);

	it.live("never reloads the document when the frame rerenders or replaces its page", () =>
		Effect.gen(function* () {
			const host = mount();
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			host.move({ search: "", kind: "route", path: "/details" }, 1);
			host.setActive(false);
			host.setActive(true);
			host.replace("page-2");
			host.refresh();

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({ type: "document", documentKey: "page-2" }),
					),
				),
			);
			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
			expect(frame.getAttribute("srcdoc")).toBe(srcDoc);
			expect(host.documentLoads()).toBe(1);
			expect(screen.queryByRole("heading", { name: "Opening Fixture" })).toBeNull();
		}),
	);

	it.live("forwards explicit route, page-search, operation target, and matching readiness", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({
				mode: "push",
				type: "navigate",
				target: { search: "q=x", path: "/shows", kind: "plugin-route", packageId: "ryot/media" },
			});
			bridge.port.postMessage({
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "movie", owner: { kind: "plugin", pluginId: "media-installation" } },
				library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
			});
			bridge.port.postMessage({
				mode: "replace",
				type: "page-search",
				update: { q: "dune", dialog: null },
			});
			bridge.port.postMessage({
				input: null,
				requestId: "op-1",
				operationSlug: "greet",
				packageId: "test/fixture",
				type: "operation-request",
			});
			bridge.port.postMessage({
				index: 0,
				key: "k0",
				type: "screen-state",
				hasPreviousScreen: true,
			});

			yield* Effect.promise(() => waitFor(() => expect(host.operations).toHaveLength(1)));
			expect(host.navigations).toEqual([{ replace: false, href: "/p/ryot/media/shows?q=x" }]);
			expect(host.searches).toEqual([
				{ mode: "replace", type: "page-search", update: { q: "dune", dialog: null } },
			]);
			expect(host.entityPicks).toEqual([
				{
					type: "pick-entity-screen",
					requestId: "pick-entity-screen-1",
					schema: { slug: "movie", owner: { kind: "plugin", pluginId: "media-installation" } },
					library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
				},
			]);
			expect(host.operations).toEqual([
				{ input: null, operationSlug: "greet", packageId: PluginPackageId.make("test/fixture") },
			]);
			expect(host.states).toContainEqual({ index: 0, key: "k0", hasPreviousScreen: true });
		}),
	);

	it.live("sends one page refresh for a host mutation-completed hint", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			host.refresh();

			yield* Effect.promise(() =>
				waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" })),
			);
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						Reflect.get(message, "type") === "page-refresh",
				),
			).toHaveLength(1);
		}),
	);

	it.live("suppresses retained frame effects and refreshes once after a missed mutation", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({ count: 1, type: "overlay-state" });
			yield* Effect.promise(() => waitFor(() => expect(host.backInterceptors.run()).toBe(true)));

			host.setActive(false);
			host.refresh();
			expect(host.backInterceptors.run()).toBe(false);
			expect(bridge.messages).not.toContainEqual({ type: "page-refresh" });

			host.setActive(true);
			yield* Effect.promise(() =>
				waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" })),
			);
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						Reflect.get(message, "type") === "page-refresh",
				),
			).toHaveLength(1);
		}),
	);

	it.live("sends one lifecycle page refresh only when the application becomes visible", () => {
		const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
		return Effect.gen(function* () {
			mount();
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			act(() => {
				Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
				document.dispatchEvent(new Event("visibilitychange"));
			});
			expect(bridge.messages).not.toContainEqual({ type: "page-refresh" });

			act(() => {
				Object.defineProperty(document, "visibilityState", {
					value: "visible",
					configurable: true,
				});
				document.dispatchEvent(new Event("visibilitychange"));
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" })),
			);
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						Reflect.get(message, "type") === "page-refresh",
				),
			).toHaveLength(1);
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					if (visibility) {
						Object.defineProperty(document, "visibilityState", visibility);
					} else {
						Reflect.deleteProperty(document, "visibilityState");
					}
				}),
			),
		);
	});

	it.live("sends the same page refresh on native resume and releases the listener", () =>
		Effect.gen(function* () {
			let resume: (() => void) | undefined;
			let released = false;
			const host = mount({
				subscribeResume: (resumed) => {
					resume = resumed;
					return () => {
						released = true;
					};
				},
			});
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			act(() => resume?.());
			yield* Effect.promise(() =>
				waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" })),
			);
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						Reflect.get(message, "type") === "page-refresh",
				),
			).toHaveLength(1);

			host.unmount();
			expect(released).toBe(true);
		}),
	);

	it.live("registers iframe overlay Back ownership and releases it after acknowledgement", () =>
		Effect.gen(function* () {
			const host = mount();
			yield* Effect.promise(() => flush());
			const bridge = connect(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({ count: 1, type: "overlay-state" });
			yield* Effect.promise(() => waitFor(() => expect(host.backInterceptors.run()).toBe(true)));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						requestId: "overlay-1",
						type: "dismiss-overlay",
					}),
				),
			);

			bridge.port.postMessage({
				dismissed: true,
				requestId: "overlay-1",
				type: "dismiss-overlay-result",
			});
			yield* Effect.promise(() => waitFor(() => expect(host.backInterceptors.run()).toBe(false)));
		}),
	);

	it.live("keeps the current frame mounted when an invalidation reports an update", () =>
		Effect.gen(function* () {
			let reloads = 0;
			let checks = 0;
			const host = mount({
				onReloadCurrent: () => {
					reloads += 1;
				},
				onCheckFreshness: () => {
					checks += 1;
					return Effect.succeed(false);
				},
			});
			yield* Effect.promise(() => flush());
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			host.move(home, 0, 1);

			yield* Effect.promise(() =>
				screen.findByText("An update is available. Reloading will discard unsaved local state."),
			);
			expect(checks).toBe(1);
			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
			expect(reloads).toBe(0);
			fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
			expect(reloads).toBe(1);
		}),
	);

	it.live("keeps the bridge mounted and reports a clear failure when an operation is stale", () =>
		Effect.gen(function* () {
			let reloads = 0;
			mount({
				onReloadCurrent: () => {
					reloads += 1;
				},
				onInvokeOperation: () => Effect.succeed({ outcome: "stale-session" }),
			});
			yield* Effect.promise(() => flush());
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			bridge.port.postMessage({
				input: null,
				operationSlug: "mutate",
				packageId: "test/fixture",
				type: "operation-request",
				requestId: "stale-operation",
			});

			yield* Effect.promise(() =>
				screen.findByText("An update is available. Reloading will discard unsaved local state."),
			);
			expect(screen.getByTitle("Fixture plugin")).toBe(frame);
			expect(reloads).toBe(0);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "failure",
						type: "operation-result",
						reason: "operation-failed",
						requestId: "stale-operation",
					}),
				),
			);
		}),
	);

	it.live("reprepares the page when the bridge fails", () =>
		Effect.gen(function* () {
			let parentReloads = 0;
			const host = mount({
				onReloadCurrent: () => {
					parentReloads += 1;
				},
			});
			yield* Effect.promise(() => flush());
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connect(frame);
			bridge.port.postMessage(bridge.ready);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			bridge.port.postMessage({ reason: "failed", type: "lifecycle-close" });

			yield* Effect.promise(() => screen.findByText("This plugin stopped working."));
			expect(screen.queryByTitle("Fixture plugin")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			expect(screen.queryByTitle("Fixture plugin")).toBeNull();
			expect(parentReloads).toBe(1);
			host.unmount();
		}),
	);

	it.live("offers a retry without rendering a frame when the document cannot load", () =>
		Effect.gen(function* () {
			let reloads = 0;
			mount({
				onReloadCurrent: () => {
					reloads++;
				},
				onLoadDocument: () =>
					Effect.fail(new AuthenticatedApiError({ cause: new Error("stale document") })),
			});
			yield* Effect.promise(() => screen.findByText("This plugin stopped working."));
			expect(screen.queryByTitle("Fixture plugin")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			expect(reloads).toBe(1);
		}),
	);
});
