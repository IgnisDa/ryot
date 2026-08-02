// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
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
import { PluginFrame, type RenewPluginArtifactSession } from "#/modules/plugins/plugin-host";
import type { ThemeStore } from "#/modules/theme/store";

const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	getSnapshot: () => ({ resolvedMode: "light" }),
	subscribe: () => () => undefined,
};
const home: PluginLogicalLocation = { kind: "route", path: "/", search: "keep=1" };
const session = {
	sessionId: "session-1",
	expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
	src: "https://artifacts.example/session-1/index.html",
};

function mount(
	options: {
		readonly onReloadCurrent?: () => void;
		readonly onRenewArtifactSession?: RenewPluginArtifactSession;
		readonly subscribeResume?: (resumed: () => void) => () => void;
		readonly onCreateArtifactSession?: () => Promise<typeof session>;
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
	const props = (location: PluginLogicalLocation, index: number, freshnessCheckRevision = 0) => ({
		theme,
		location,
		title: "Fixture",
		backInterceptors,
		mutationCompleted,
		chromeLeading: null,
		freshnessCheckRevision,
		sourceHash: "graph-hash",
		installationId: "build-1",
		onHeader: () => undefined,
		artifactHash: "artifact-hash",
		onOpenDrawer: () => undefined,
		onNavigateBack: () => undefined,
		onOverlayState: () => undefined,
		onKernelShortcut: () => undefined,
		chromeTriggerRef: { current: null },
		artifactSessionScopeKey: "server:user",
		subscribeResume: options.subscribeResume,
		viewport: { safeAreaTop: 7, safeAreaBottom: 11 },
		onRevokeArtifactSession: () => Promise.resolve(),
		onReloadCurrent: options.onReloadCurrent ?? (() => undefined),
		onScreenState: (state: unknown) => states.push(state),
		onPageSearch: (request: unknown) => searches.push(request),
		onNavigate: (request: unknown) => navigations.push(request),
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		onProviderSearch: (request: unknown) => providerSearches.push(request),
		onCreateArtifactSession: options.onCreateArtifactSession ?? (() => Promise.resolve(session)),
		onQuery: () => Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onAssets: () => Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onUpload: () => Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onCollection: () =>
			Promise.resolve({ outcome: "failure" as const, reason: "transport" as const }),
		onRenewArtifactSession:
			options.onRenewArtifactSession ??
			(() => Promise.resolve({ outcome: "renewed" as const, expiresAt: session.expiresAt })),
		onInvokeOperation: (request: PluginOperationRequest) => {
			operations.push(request);
			return (
				options.onInvokeOperation?.(request) ??
				Promise.resolve({ outcome: "success" as const, value: null })
			);
		},
		navigation: {
			index,
			location,
			compact: true,
			key: `k${index}`,
			edgeBack: index > 0,
			leading: index > 0 ? ("back" as const) : ("drawer" as const),
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
	fireEvent.load(frame);
	if (init === undefined || port === undefined) {
		throw new Error("Bridge did not connect");
	}
	const { mode: _mode, safeAreaTop: _top, safeAreaBottom: _bottom, ...ready } = init;
	return { init, messages, port, ready };
}

describe("PluginFrame", () => {
	it("uses one session and bridge while location and global history change", async () => {
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

	it("forwards explicit route, page-search, operation target, and matching readiness", async () => {
		const host = mount();
		await flush();
		const bridge = connect(screen.getByTitle("Fixture plugin"));
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		bridge.port.postMessage({
			mode: "push",
			type: "navigate",
			target: { kind: "plugin-route", pluginSlug: "media", path: "/shows", search: "q=x" },
		});
		bridge.port.postMessage({
			entitySchemaSlug: "movie",
			type: "provider-search-screen",
			ownerPluginId: "media-installation",
		});
		bridge.port.postMessage({
			mode: "replace",
			type: "page-search",
			update: { dialog: null, q: "dune" },
		});
		bridge.port.postMessage({
			input: null,
			requestId: "op-1",
			pluginSlug: "fixture",
			operationSlug: "greet",
			type: "operation-request",
		});
		bridge.port.postMessage({ type: "screen-state", index: 0, key: "k0", hasPreviousScreen: true });

		await waitFor(() => expect(host.operations).toHaveLength(1));
		expect(host.navigations).toEqual([{ href: "/media/shows?q=x", replace: false }]);
		expect(host.searches).toEqual([
			{ mode: "replace", update: { dialog: null, q: "dune" }, type: "page-search" },
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

	it("keeps the current frame mounted when freshness renewal reports an update", async () => {
		let reloads = 0;
		let renewals = 0;
		const host = mount({
			onReloadCurrent: () => {
				reloads += 1;
			},
			onRenewArtifactSession: () => {
				renewals += 1;
				return Promise.resolve({ outcome: "replace", reason: "stale" });
			},
		});
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		host.move(home, 0, 1);

		await screen.findByText("An update is available. Reloading will discard unsaved local state.");
		expect(renewals).toBe(1);
		expect(screen.getByTitle("Fixture plugin")).toBe(frame);
		expect(reloads).toBe(0);
		fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
		expect(reloads).toBe(1);
	});

	it("renews once when freshness changes during session creation", async () => {
		let resolveCreation: ((created: typeof session) => void) | undefined;
		let renewals = 0;
		const host = mount({
			onCreateArtifactSession: () =>
				new Promise((resolve) => {
					resolveCreation = resolve;
				}),
			onRenewArtifactSession: () => {
				renewals += 1;
				return Promise.resolve({ outcome: "renewed", expiresAt: session.expiresAt });
			},
		});

		host.move(home, 0, 1);
		expect(renewals).toBe(0);
		act(() => resolveCreation?.(session));
		await waitFor(() => expect(renewals).toBe(1));
	});

	it("coalesces freshness changes during renewal into one subsequent renewal", async () => {
		let resolveFirst: ((result: { outcome: "renewed"; expiresAt: string }) => void) | undefined;
		let renewals = 0;
		const host = mount({
			onRenewArtifactSession: () => {
				renewals += 1;
				if (renewals === 1) {
					return new Promise((resolve) => {
						resolveFirst = resolve;
					});
				}
				return Promise.resolve({ outcome: "renewed", expiresAt: session.expiresAt });
			},
		});
		await flush();

		host.move(home, 0, 1);
		await waitFor(() => expect(renewals).toBe(1));
		host.move(home, 0, 2);
		host.move(home, 0, 3);
		expect(renewals).toBe(1);
		act(() => resolveFirst?.({ outcome: "renewed", expiresAt: session.expiresAt }));
		await waitFor(() => expect(renewals).toBe(2));
	});

	it("replaces the current frame when freshness renewal reports a missing session", async () => {
		let renewals = 0;
		const host = mount({
			onRenewArtifactSession: () => {
				renewals += 1;
				return Promise.resolve({ outcome: "replace", reason: "not-found" });
			},
		});
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
		const bridge = connect(frame);
		bridge.port.postMessage(bridge.ready);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		host.move(home, 0, 1);

		const nextFrame = await waitFor(() => {
			expect(renewals).toBe(1);
			const currentFrame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
			expect(currentFrame).not.toBe(frame);
			return currentFrame;
		});
		expect(nextFrame).not.toBe(frame);
		expect(
			screen.queryByText("An update is available. Reloading will discard unsaved local state."),
		).toBeNull();
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

	it("disposes a genuinely failed bridge and locally reloads it", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Reload plugin" }));
		const nextFrame = await screen.findByTitle<HTMLIFrameElement>("Fixture plugin");
		expect(nextFrame).not.toBe(frame);
		expect(parentReloads).toBe(0);
		host.unmount();
	});
});
