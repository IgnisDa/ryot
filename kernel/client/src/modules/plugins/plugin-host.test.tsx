// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	CLIENT_BRIDGE_BOOTSTRAP_READY,
	PluginBridgeInit,
	type PluginLogicalLocation,
	type PluginOperationRequest,
} from "@ryot-app/client-plugin-contract";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import type { PluginOperationDispatchOutcome } from "#/modules/plugins/operations";
import { PluginFrame } from "#/modules/plugins/plugin-host";
import type { ThemeStore } from "#/modules/theme/store";

const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => ({ resolvedMode: "light" }),
};
const home: PluginLogicalLocation = { path: "/", kind: "route", search: "keep=1" };
const grant = {
	grantId: "grant-1",
	expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
	src: "https://artifacts.example/api/client-pages/documents/session-1",
};

function mount(
	options: {
		readonly onReloadCurrent?: () => void;
		readonly onCheckFreshness?: (signal: AbortSignal) => Promise<boolean>;
		readonly subscribeResume?: (resumed: () => void) => () => void;
		readonly onInvokeOperation?: (
			request: PluginOperationRequest,
		) => Promise<PluginOperationDispatchOutcome>;
	} = {},
) {
	const backInterceptors = createBackInterceptors();
	const states: unknown[] = [];
	const searches: unknown[] = [];
	const navigations: unknown[] = [];
	const providerSearches: unknown[] = [];
	const operations: PluginOperationRequest[] = [];
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
	) => ({
		theme,
		active,
		location,
		title: "Fixture",
		backInterceptors,
		mutationCompleted,
		chromeLeading: null,
		documentGrant: grant,
		documentKey: pageKey,
		freshnessCheckRevision,
		onHeader: () => undefined,
		onOpenDrawer: () => undefined,
		onNavigateBack: () => undefined,
		onOverlayState: () => undefined,
		onKernelShortcut: () => undefined,
		chromeTriggerRef: { current: null },
		compositionHash: "composition-hash",
		subscribeResume: options.subscribeResume,
		viewport: { safeAreaTop: 7, safeAreaBottom: 11 },
		onScreenState: (state: unknown) => states.push(state),
		onPageSearch: (request: unknown) => searches.push(request),
		onNavigate: (request: unknown) => navigations.push(request),
		onReloadCurrent: options.onReloadCurrent ?? (() => undefined),
		onProviderSearch: (request: unknown) => providerSearches.push(request),
		onCheckFreshness: options.onCheckFreshness ?? (() => Promise.resolve(true)),
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		onQuery: () => Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onAssets: () => Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onUpload: () => Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onCollection: () =>
			Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
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
				Promise.resolve({ value: null, outcome: "success" as const })
			);
		},
		page: {
			view: null,
			settings: {},
			dataSources: null,
			route: { params: {} },
			renderer: { name: "fixture", kind: "kernel" as const },
			target: {
				search: "",
				path: pageKey,
				kind: "plugin-route" as const,
				pluginSlug: PluginSlug.make("fixture"),
			},
		},
	});
	const view = render(<PluginFrame {...props(home, 0)} />);
	return {
		...view,
		states,
		searches,
		operations,
		navigations,
		providerSearches,
		backInterceptors,
		refresh: mutationCompleted.hint,
		setActive: (active: boolean) => view.rerender(<PluginFrame {...props(home, 0, 0, active)} />),
		replace: (pageKey: string) =>
			view.rerender(<PluginFrame {...props(home, 0, 0, true, pageKey)} />),
		move: (location: PluginLogicalLocation, index: number, freshnessCheckRevision = 0) =>
			view.rerender(<PluginFrame {...props(location, index, freshnessCheckRevision)} />),
	};
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
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

describe("PluginFrame", () => {
	it("uses one grant and bridge while location and global history change", async () => {
		const host = mount();
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		host.move({ kind: "route", path: "/details", search: "keep=1&tab=stats" }, 1);
		await waitFor(() => expect(bridge.messages).toHaveLength(2));

		expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		expect(bridge.init).toMatchObject({ safeAreaTop: 7, safeAreaBottom: 11 });
		expect(bridge.messages[1]).toMatchObject({
			index: 1,
			key: "k1",
			compact: true,
			edgeBack: true,
			location: { kind: "route", path: "/details", search: "keep=1&tab=stats" },
		});
	});

	it("replaces a document without reloading the iframe and clears page-owned state", async () => {
		const host = mount();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		bridge.port.postMessage({ count: 1, type: "overlay-state" });
		bridge.port.postMessage({ shortcuts: ["A"], type: "page-shortcuts" });
		await waitFor(() => expect(host.backInterceptors.run()).toBe(true));
		host.replace("page-2");
		await waitFor(() =>
			expect(bridge.messages).toContainEqual(
				expect.objectContaining({
					type: "document",
					documentKey: "page-2",
					page: expect.objectContaining({ target: expect.objectContaining({ path: "page-2" }) }),
				}),
			),
		);
		expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		expect(host.backInterceptors.run()).toBe(false);
	});

	it("forwards explicit route, page-search, operation target, and matching readiness", async () => {
		const host = mount();
		await flush();
		const bridge = connect(screen.getByTitle("Fixture plugin"));
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		bridge.port.postMessage({
			mode: "push",
			type: "navigate",
			target: { search: "q=x", path: "/shows", pluginSlug: "media", kind: "plugin-route" },
		});
		bridge.port.postMessage({
			entitySchemaSlug: "movie",
			type: "provider-search-screen",
			ownerPluginId: "media-installation",
		});
		bridge.port.postMessage({
			mode: "replace",
			type: "page-search",
			update: { q: "dune", dialog: null },
		});
		bridge.port.postMessage({
			input: null,
			requestId: "op-1",
			pluginSlug: "fixture",
			operationSlug: "greet",
			type: "operation-request",
		});
		bridge.port.postMessage({ index: 0, key: "k0", type: "screen-state", hasPreviousScreen: true });

		await waitFor(() => expect(host.operations).toHaveLength(1));
		expect(host.navigations).toEqual([{ replace: false, href: "/media/shows?q=x" }]);
		expect(host.searches).toEqual([
			{ mode: "replace", type: "page-search", update: { q: "dune", dialog: null } },
		]);
		expect(host.providerSearches).toEqual([
			{
				entitySchemaSlug: "movie",
				type: "provider-search-screen",
				ownerPluginId: "media-installation",
			},
		]);
		expect(host.operations).toEqual([
			{ input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
		]);
		expect(host.states).toContainEqual({ index: 0, key: "k0", hasPreviousScreen: true });
	});

	it("sends one page refresh for a host mutation-completed hint", async () => {
		const host = mount();
		await flush();
		const bridge = connect(screen.getByTitle("Fixture plugin"));
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		host.refresh();

		await waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" }));
		expect(
			bridge.messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					Reflect.get(message, "type") === "page-refresh",
			),
		).toHaveLength(1);
	});

	it("suppresses retained frame effects and refreshes once after a missed mutation", async () => {
		const host = mount();
		await flush();
		const bridge = connect(screen.getByTitle("Fixture plugin"));
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		bridge.port.postMessage({ count: 1, type: "overlay-state" });
		await waitFor(() => expect(host.backInterceptors.run()).toBe(true));

		host.setActive(false);
		host.refresh();
		expect(host.backInterceptors.run()).toBe(false);
		expect(bridge.messages).not.toContainEqual({ type: "page-refresh" });

		host.setActive(true);
		await waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" }));
		expect(
			bridge.messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					Reflect.get(message, "type") === "page-refresh",
			),
		).toHaveLength(1);
	});

	it("sends one lifecycle page refresh only when the application becomes visible", async () => {
		const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
		try {
			mount();
			await flush();
			const bridge = connect(screen.getByTitle("Fixture plugin"));
			bridge.port.postMessage(bridge.ready);
			await waitFor(() => expect(bridge.messages).toHaveLength(1));

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
			await waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" }));
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						Reflect.get(message, "type") === "page-refresh",
				),
			).toHaveLength(1);
		} finally {
			if (visibility) {
				Object.defineProperty(document, "visibilityState", visibility);
			} else {
				Reflect.deleteProperty(document, "visibilityState");
			}
		}
	});

	it("sends the same page refresh on native resume and releases the listener", async () => {
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
		await flush();
		const bridge = connect(screen.getByTitle("Fixture plugin"));
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		act(() => resume?.());
		await waitFor(() => expect(bridge.messages).toContainEqual({ type: "page-refresh" }));
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
	});

	it("registers iframe overlay Back ownership and releases it after acknowledgement", async () => {
		const host = mount();
		await flush();
		const bridge = connect(screen.getByTitle("Fixture plugin"));
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		bridge.port.postMessage({ count: 1, type: "overlay-state" });
		await waitFor(() => expect(host.backInterceptors.run()).toBe(true));
		await waitFor(() =>
			expect(bridge.messages).toContainEqual({ requestId: "overlay-1", type: "dismiss-overlay" }),
		);

		bridge.port.postMessage({
			dismissed: true,
			requestId: "overlay-1",
			type: "dismiss-overlay-result",
		});
		await waitFor(() => expect(host.backInterceptors.run()).toBe(false));
	});

	it("keeps the current frame mounted when an invalidation reports an update", async () => {
		let reloads = 0;
		let checks = 0;
		const host = mount({
			onReloadCurrent: () => {
				reloads += 1;
			},
			onCheckFreshness: () => {
				checks += 1;
				return Promise.resolve(false);
			},
		});
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		host.move(home, 0, 1);

		await screen.findByText("An update is available. Reloading will discard unsaved local state.");
		expect(checks).toBe(1);
		expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		expect(reloads).toBe(0);
		fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
		expect(reloads).toBe(1);
	});

	it("keeps the bridge mounted and reports a clear failure when an operation is stale", async () => {
		let reloads = 0;
		mount({
			onReloadCurrent: () => {
				reloads += 1;
			},
			onInvokeOperation: () => Promise.resolve({ outcome: "stale-session" }),
		});
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		bridge.port.postMessage({
			input: null,
			pluginSlug: "fixture",
			operationSlug: "mutate",
			type: "operation-request",
			requestId: "stale-operation",
		});

		await screen.findByText("An update is available. Reloading will discard unsaved local state.");
		expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		expect(reloads).toBe(0);
		await waitFor(() =>
			expect(bridge.messages).toContainEqual({
				outcome: "failure",
				type: "operation-result",
				reason: "operation-failed",
				requestId: "stale-operation",
			}),
		);
	});

	it("requests a new document grant when the bridge fails", async () => {
		let parentReloads = 0;
		const host = mount({
			onReloadCurrent: () => {
				parentReloads += 1;
			},
		});
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		bridge.port.postMessage({ reason: "failed", type: "lifecycle-close" });

		await screen.findByText("This plugin stopped working.");
		expect(screen.queryByTitle("Fixture plugin")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(screen.queryByTitle("Fixture plugin")).toBeNull();
		expect(parentReloads).toBe(1);
		host.unmount();
	});

	it("offers a retry when the initial document cannot load", async () => {
		let reloads = 0;
		mount({
			onReloadCurrent: () => {
				reloads++;
			},
		});
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		fireEvent.error(frame);
		await screen.findByText("This plugin stopped working.");
		expect(screen.queryByTitle("Fixture plugin")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(reloads).toBe(1);
	});
});
