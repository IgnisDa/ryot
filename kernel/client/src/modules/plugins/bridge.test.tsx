import { afterEach, describe, expect, it } from "@effect/vitest";
// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort takes a transfer list, not an origin
import {
	PluginBridgeInit,
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginAssetBridgeErrorReason,
	type PluginBridgeNavigate,
	type PluginBridgeReady,
	type KernelShortcut,
	type PageShortcutKey,
	type PluginLogicalLocation,
	type PluginRouteLocation,
	type PluginThemeSnapshot,
	type PluginAssetOutcome,
	type PluginAssetRequest,
	type PluginCollectionOutcome,
	type PluginCollectionRequest,
	type PluginOperationBridgeErrorReason,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
	type PluginStorageOutcome,
	type PluginStorageRequest,
	type PluginUploadRequest,
} from "@ryot-app/client-plugin-contract";
import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { MembershipResponse } from "@ryot-app/contract/modules/collections/schemas";
import { EntityId, EntitySchemaSlug, PluginSlug } from "@ryot-app/contract/schema/brands";
import { waitFor } from "@testing-library/dom";
import { Effect, Schema } from "effect";

import {
	openPluginBridge,
	type PluginBridgeSession,
	type PluginScreenReadiness,
} from "#/modules/plugins/bridge";

const decodeInit = Schema.decodeUnknownSync(PluginBridgeInit);

const compositionHash = "composition-hash";
const home: PluginRouteLocation = { path: "/", search: "", kind: "route" };
const detail: PluginRouteLocation = { search: "", kind: "route", path: "/details/1" };
const entity: PluginLogicalLocation = {
	search: "",
	kind: "entity",
	entityId: EntityId.make("entity-1"),
	entitySchemaSlug: EntitySchemaSlug.make("show"),
};
const nav = (location: PluginLogicalLocation = home, index = 0) => ({
	index,
	location,
	compact: false,
	edgeBack: false,
	key: `k${index}`,
	leading: "none" as const,
});
const at = (location: PluginLogicalLocation = home, index = 0) => ({
	...nav(location, index),
	type: "location" as const,
});
const lightTheme: PluginThemeSnapshot = { resolvedMode: "light" };
const darkTheme: PluginThemeSnapshot = { resolvedMode: "dark" };
const membership = Schema.decodeSync(MembershipResponse)({
	warnings: [],
	memberOf: {
		properties: {},
		id: "relationship-1",
		sourceEntityId: "entity-1",
		targetEntityId: "collection-1",
		relationshipSchemaSlug: "member-of",
		createdAt: "2026-09-07T00:00:00.000Z",
	},
});
const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 10 } },
		},
	},
} as const;

const ports: MessagePort[] = [];
const sessions: PluginBridgeSession[] = [];

afterEach(() => {
	for (const session of sessions.splice(0)) {
		session.close();
	}
	for (const port of ports.splice(0)) {
		port.close();
	}
});

const delay = (ms: number) => Effect.runPromise(Effect.sleep(ms));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	// oxlint-disable-next-line effecttsgo/new-promise -- This controllable test gate stays pending until the host callback or test releases it.
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { reject, promise, resolve };
}

const connect = (
	options: {
		readonly timeoutMs?: number;
		readonly onAssets?: Parameters<typeof openPluginBridge>[0]["onAssets"];
		readonly onUpload?: Parameters<typeof openPluginBridge>[0]["onUpload"];
		readonly scheduleOverlayDismissTimeout?: (onTimeout: () => void) => () => void;
		readonly watchEntities?: Parameters<typeof openPluginBridge>[0]["watchEntities"];
		readonly onCollection?: Parameters<typeof openPluginBridge>[0]["onCollection"];
		readonly onOperation?: Parameters<typeof openPluginBridge>[0]["onOperation"];
		readonly onRyotQL?: Parameters<typeof openPluginBridge>[0]["onRyotQL"];
		readonly onStorage?: Parameters<typeof openPluginBridge>[0]["onStorage"];
	} = {},
) => {
	const backs: null[] = [];
	const drawers: null[] = [];
	const readies: null[] = [];
	const failures: null[] = [];
	const origins: string[] = [];
	const received: unknown[] = [];
	const messages: unknown[] = [];
	const pageSearches: unknown[] = [];
	const overlayStates: number[] = [];
	let init: PluginBridgeInit | undefined;
	const shortcuts: KernelShortcut[] = [];
	const providerSearches: unknown[] = [];
	let pluginPort: MessagePort | undefined;
	const navigations: PluginBridgeNavigate[] = [];
	const screenStates: PluginScreenReadiness[] = [];
	const pageShortcuts: (readonly PageShortcutKey[])[] = [];
	const operationCalls: Array<{
		readonly input: unknown;
		readonly pluginSlug: string;
		readonly operationSlug: string;
	}> = [];

	const session = openPluginBridge({
		compositionHash,
		navigation: nav(),
		theme: lightTheme,
		onHeader: () => {},
		documentKey: "page-1",
		timeoutMs: options.timeoutMs,
		onReady: () => readies.push(null),
		onFailure: () => failures.push(null),
		onNavigateBack: () => backs.push(null),
		onOpenDrawer: () => drawers.push(null),
		viewport: { safeAreaTop: 0, safeAreaBottom: 0 },
		onNavigate: (request) => navigations.push(request),
		onScreenState: (state) => screenStates.push(state),
		onAssets: options.onAssets ?? (() => Effect.never),
		onRyotQL: options.onRyotQL ?? (() => Effect.never),
		onUpload: options.onUpload ?? (() => Effect.never),
		onOverlayState: (count) => overlayStates.push(count),
		onStorage: options.onStorage ?? (() => Effect.never),
		onPageSearch: (request) => pageSearches.push(request),
		onKernelShortcut: (shortcut) => shortcuts.push(shortcut),
		onCollection: options.onCollection ?? (() => Effect.never),
		onProviderSearch: (request) => providerSearches.push(request),
		onPageShortcuts: (registered) => pageShortcuts.push(registered),
		scheduleOverlayDismissTimeout: options.scheduleOverlayDismissTimeout,
		watchEntities: options.watchEntities ?? (() => ({ update: () => {}, dispose: () => {} })),
		onOperation:
			options.onOperation ??
			((request) => {
				operationCalls.push({
					input: request.input,
					pluginSlug: request.pluginSlug,
					operationSlug: request.operationSlug,
				});
				return Effect.never;
			}),
		target: {
			postMessage: (message, targetOrigin, transfer) => {
				const [transferred] = transfer;
				if (!(transferred instanceof MessagePort)) {
					throw new Error("The bridge did not transfer a MessagePort.");
				}
				origins.push(targetOrigin);
				init = decodeInit(message);
				transferred.addEventListener("message", (event) => {
					messages.push(event.data);
					received.push(event.data);
				});
				transferred.start();
				ports.push(transferred);
				pluginPort = transferred;
			},
		},
	});
	sessions.push(session);

	if (init === undefined || pluginPort === undefined) {
		throw new Error("The bridge never transferred a port to the plugin document.");
	}
	const rawPort = pluginPort;
	const testPort = {
		close: () => rawPort.close(),
		postMessage: (message: unknown) => {
			const value =
				typeof message === "object" &&
				message !== null &&
				"type" in message &&
				message.type === "operation-request" &&
				!("pluginSlug" in message)
					? { ...message, pluginSlug: PluginSlug.make("fixture") }
					: message;
			rawPort.postMessage(value);
		},
	};
	return {
		init,
		backs,
		session,
		origins,
		readies,
		drawers,
		failures,
		messages,
		received,
		shortcuts,
		navigations,
		screenStates,
		pageSearches,
		pageShortcuts,
		overlayStates,
		operationCalls,
		providerSearches,
		pluginPort: testPort,
	};
};

const readyFor = (init: PluginBridgeInit): PluginBridgeReady => ({
	compositionHash,
	sessionId: init.sessionId,
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
});

describe("bridge page screens", () => {
	it.live("delivers the latest document when navigation changes before handshake completes", () =>
		Effect.gen(function* () {
			const { init, session, received, pluginPort } = connect();
			const page = {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { name: "fixture", kind: "kernel" as const },
				target: {
					search: "",
					path: "/music",
					kind: "plugin-route" as const,
					pluginSlug: PluginSlug.make("fixture"),
				},
			};
			session.sendDocument("music", page, nav(detail, 1));
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						page,
						type: "document",
						documentKey: "music",
						navigation: at(detail, 1),
					}),
				),
			);
			expect(received).toHaveLength(1);
		}),
	);
	it.live("replaces the document on the same port and cancels old page requests", () =>
		Effect.gen(function* () {
			let aborted = false;
			const { init, session, received, pluginPort, overlayStates, pageShortcuts } = connect({
				onRyotQL: () =>
					Effect.promise((signal) => {
						signal.addEventListener("abort", () => {
							aborted = true;
						});
						// oxlint-disable-next-line effecttsgo/new-promise -- This test keeps the injected host request pending to verify cancellation or admission.
						return new Promise<never>(() => {});
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toEqual([at()])));
			pluginPort.postMessage({ document, type: "ryotql-request", requestId: "old-query" });
			pluginPort.postMessage({ count: 1, type: "overlay-state" });
			pluginPort.postMessage({ shortcuts: ["A"], type: "page-shortcuts" });
			yield* Effect.promise(() => waitFor(() => expect(pageShortcuts).toContainEqual(["A"])));
			const page = {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { name: "fixture", kind: "kernel" as const },
				target: {
					search: "",
					path: "/music",
					kind: "plugin-route" as const,
					pluginSlug: PluginSlug.make("fixture"),
				},
			};
			session.sendDocument("music", page, nav());
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						page,
						type: "document",
						navigation: at(),
						documentKey: "music",
					}),
				),
			);
			expect(aborted).toBe(true);
			expect(overlayStates.at(-1)).toBe(0);
			expect(pageShortcuts.at(-1)).toEqual([]);
		}),
	);
	it.live("forwards provider search and sends one page refresh", () =>
		Effect.gen(function* () {
			const { init, session, received, pluginPort, providerSearches } = connect();
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toEqual([at()])));

			pluginPort.postMessage({
				initialQuery: "Dune",
				entitySchemaSlug: "movie",
				type: "provider-search-screen",
				ownerPluginId: "media-installation",
			});
			yield* Effect.promise(() => waitFor(() => expect(providerSearches).toHaveLength(1)));
			session.sendPageRefresh();
			yield* Effect.promise(() =>
				waitFor(() => expect(received).toContainEqual({ type: "page-refresh" })),
			);

			expect(providerSearches).toEqual([
				{
					initialQuery: "Dune",
					entitySchemaSlug: "movie",
					type: "provider-search-screen",
					ownerPluginId: "media-installation",
				},
			]);
		}),
	);

	it.live("registers only allowlisted page shortcuts and sends presses back down", () =>
		Effect.gen(function* () {
			const { init, session, received, pluginPort, pageShortcuts } = connect();
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toEqual([at()])));

			pluginPort.postMessage({
				type: "page-shortcuts",
				shortcuts: ["A", "/", "A", "Mod+K", "a", "Escape"],
			});
			yield* Effect.promise(() => waitFor(() => expect(pageShortcuts).toHaveLength(1)));
			expect(pageShortcuts[0]).toEqual(["/", "A"]);

			session.sendShortcut("A");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({ shortcut: "A", type: "page-shortcut-press" }),
				),
			);
		}),
	);
});

describe("bridge entity interest", () => {
	it.live.each(["close", "crash", "invalid"])(
		"keeps one mutable owner and releases it on %s",
		(exit) =>
			Effect.gen(function* () {
				const declarations: unknown[] = [];
				let disposed = 0;
				let notify:
					| Parameters<Parameters<typeof openPluginBridge>[0]["watchEntities"]>[1]
					| undefined;
				const client = createRyotClient(
					createTestRyotAdapter({
						query: () => Effect.succeed({}),
						watchEntities: (interest, onUpdate) => {
							declarations.push(interest);
							notify = onUpdate;
							return {
								update: (next) => declarations.push(next),
								dispose: () => {
									disposed++;
								},
							};
						},
					}),
				);
				const bridge = connect({ watchEntities: client.entities.watch });
				bridge.pluginPort.postMessage(readyFor(bridge.init));
				yield* Effect.promise(() => waitFor(() => expect(bridge.readies).toHaveLength(1)));
				bridge.pluginPort.postMessage({ visible: [], foreground: ["a"], type: "entity-interest" });
				yield* Effect.promise(() =>
					waitFor(() => expect(declarations).toEqual([{ visible: [], foreground: ["a"] }])),
				);
				notify?.({ entityId: "a", reason: "populated" });
				notify?.({ entityId: "other", reason: "translated" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(bridge.received).toContainEqual({
							entityId: "a",
							reason: "populated",
							type: "entity-updated",
						}),
					),
				);
				bridge.pluginPort.postMessage({ foreground: [], visible: ["b"], type: "entity-interest" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(declarations).toEqual([
							{ visible: [], foreground: ["a"] },
							{ foreground: [], visible: ["b"] },
						]),
					),
				);
				notify?.({ entityId: "a", reason: "translated" });
				notify?.({ entityId: "b", reason: "translated" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(bridge.received).toContainEqual({
							entityId: "b",
							reason: "translated",
							type: "entity-updated",
						}),
					),
				);
				if (exit === "close") {
					bridge.session.close();
				} else {
					bridge.pluginPort.postMessage(
						exit === "crash" ? { reason: "failed", type: "lifecycle-close" } : { type: "invalid" },
					);
				}
				yield* Effect.promise(() => waitFor(() => expect(disposed).toBe(1)));
				notify?.({ entityId: "b", reason: "populated" });
				bridge.session.close();
				yield* Effect.promise(() => delay(10));
				expect(disposed).toBe(1);
				expect(
					bridge.received.filter(
						(message) =>
							typeof message === "object" &&
							message !== null &&
							"type" in message &&
							message.type === "entity-updated",
					),
				).toEqual([
					{ entityId: "a", reason: "populated", type: "entity-updated" },
					{ entityId: "b", reason: "translated", type: "entity-updated" },
				]);
			}),
	);

	it.live("does not spend request slots or fail the iframe when interest transport fails", () =>
		Effect.gen(function* () {
			let declarations = 0;
			const bridge = connect({
				watchEntities: () => {
					declarations++;
					throw new Error("offline");
				},
			});
			bridge.pluginPort.postMessage(readyFor(bridge.init));
			yield* Effect.promise(() => waitFor(() => expect(bridge.readies).toHaveLength(1)));
			for (let i = 0; i < CLIENT_BRIDGE_MAX_PENDING_REQUESTS; i++) {
				bridge.pluginPort.postMessage({
					input: {},
					type: "operation-request",
					requestId: `request-${i}`,
					operationSlug: "operation",
				});
			}
			bridge.pluginPort.postMessage({ visible: [], foreground: ["a"], type: "entity-interest" });
			yield* Effect.promise(() => waitFor(() => expect(declarations).toBe(1)));
			expect(bridge.failures).toEqual([]);
		}),
	);
});

describe("plugin bridge", () => {
	it.live("allows one acknowledged overlay dismissal at a time and preserves aggregate order", () =>
		Effect.gen(function* () {
			const { init, session, received, pluginPort, overlayStates } = connect();
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));
			pluginPort.postMessage({ count: 2, type: "overlay-state" });
			yield* Effect.promise(() => waitFor(() => expect(overlayStates).toContain(2)));

			expect(session.requestOverlayDismiss()).toBe(true);
			expect(session.requestOverlayDismiss()).toBe(true);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						received.filter(
							(message) => Reflect.get(Object(message), "type") === "dismiss-overlay",
						),
					).toHaveLength(1),
				),
			);
			pluginPort.postMessage({
				dismissed: true,
				requestId: "overlay-1",
				type: "dismiss-overlay-result",
			});
			yield* Effect.promise(() => waitFor(() => expect(overlayStates.at(-1)).toBe(1)));

			expect(session.requestOverlayDismiss()).toBe(true);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({ requestId: "overlay-2", type: "dismiss-overlay" }),
				),
			);
		}),
	);

	it.live("fails a document whose overlay dismissal is not acknowledged within the bound", () =>
		Effect.gen(function* () {
			let expire: (() => void) | undefined;
			const { init, session, failures, pluginPort } = connect({
				scheduleOverlayDismissTimeout: (onTimeout) => {
					expire = onTimeout;
					return () => {
						expire = undefined;
					};
				},
			});
			pluginPort.postMessage(readyFor(init));
			pluginPort.postMessage({ count: 1, type: "overlay-state" });
			yield* Effect.promise(() =>
				waitFor(() => expect(session.requestOverlayDismiss()).toBe(true)),
			);

			expire?.();

			expect(failures).toHaveLength(1);
			expect(session.requestOverlayDismiss()).toBe(false);
		}),
	);

	it.live("routes explicit plugin Back through an owned overlay before navigation", () =>
		Effect.gen(function* () {
			const { init, backs, received, pluginPort } = connect();
			pluginPort.postMessage(readyFor(init));
			pluginPort.postMessage({ count: 1, type: "overlay-state" });
			pluginPort.postMessage({ type: "navigate-back" });

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({ requestId: "overlay-1", type: "dismiss-overlay" }),
				),
			);
			expect(backs).toEqual([]);
		}),
	);

	it("transfers exactly one port with the exact init markers and the resolved mode", () => {
		const { init, origins } = connect();

		expect(origins).toEqual(["*"]);
		expect(init).toEqual({
			mode: "light",
			safeAreaTop: 0,
			compositionHash,
			safeAreaBottom: 0,
			documentKey: "page-1",
			sessionId: init.sessionId,
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		});
		expect(init.sessionId).not.toBe("");
	});

	it.live("cleans up immediately when the initial port transfer fails", () =>
		Effect.gen(function* () {
			const failures: null[] = [];
			const session = openPluginBridge({
				timeoutMs: 10,
				compositionHash,
				navigation: nav(),
				theme: lightTheme,
				onHeader: () => {},
				documentKey: "page-1",
				onReady: () => undefined,
				onNavigate: () => undefined,
				onAssets: () => Effect.never,
				onRyotQL: () => Effect.never,
				onUpload: () => Effect.never,
				onStorage: () => Effect.never,
				onPageSearch: () => undefined,
				onOpenDrawer: () => undefined,
				onScreenState: () => undefined,
				onOverlayState: () => undefined,
				onOperation: () => Effect.never,
				onNavigateBack: () => undefined,
				onCollection: () => Effect.never,
				onPageShortcuts: () => undefined,
				onKernelShortcut: () => undefined,
				onProviderSearch: () => undefined,
				onFailure: () => failures.push(null),
				viewport: { safeAreaTop: 0, safeAreaBottom: 0 },
				watchEntities: () => ({ update: () => {}, dispose: () => {} }),
				target: {
					postMessage: () => {
						throw new Error("transfer failed");
					},
				},
			});
			sessions.push(session);

			expect(failures).toHaveLength(1);
			yield* Effect.promise(() => delay(40));
			expect(failures).toHaveLength(1);
		}),
	);

	it.live("readies with the location as soon as the plugin reports ready", () =>
		Effect.gen(function* () {
			const { init, readies, failures, messages, pluginPort } = connect();

			pluginPort.postMessage(readyFor(init));

			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			expect(messages).toEqual([at()]);
			expect(failures).toEqual([]);
		}),
	);

	it.live("forwards matching active screen readiness without protocol policy", () =>
		Effect.gen(function* () {
			const { init, readies, pluginPort, screenStates } = connect();

			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			pluginPort.postMessage({
				index: 0,
				key: "k0",
				type: "screen-state",
				hasPreviousScreen: true,
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screenStates).toEqual([{ index: 0, key: "k0", hasPreviousScreen: true }]),
				),
			);
		}),
	);

	it.live("dispatches semantic kernel shortcuts once ready", () =>
		Effect.gen(function* () {
			const { init, readies, shortcuts, pluginPort } = connect();

			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			pluginPort.postMessage({ type: "kernel-shortcut", shortcut: "command-center" });
			pluginPort.postMessage({ type: "kernel-shortcut", shortcut: "workspace-switcher" });

			yield* Effect.promise(() =>
				waitFor(() => expect(shortcuts).toEqual(["command-center", "workspace-switcher"])),
			);
		}),
	);

	it.live("ignores screen readiness that no longer matches the latest navigation", () =>
		Effect.gen(function* () {
			const { init, readies, session, pluginPort, screenStates } = connect();

			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			session.sendLocation(nav(detail, 1));
			pluginPort.postMessage({
				index: 0,
				key: "k0",
				type: "screen-state",
				hasPreviousScreen: true,
			});
			pluginPort.postMessage({
				index: 1,
				key: "k1",
				type: "screen-state",
				hasPreviousScreen: false,
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screenStates).toEqual([{ index: 1, key: "k1", hasPreviousScreen: false }]),
				),
			);
		}),
	);

	it.live("does not process screen readiness before activation or after close", () =>
		Effect.gen(function* () {
			const premature = connect();
			premature.pluginPort.postMessage({
				index: 0,
				key: "k0",
				type: "screen-state",
				hasPreviousScreen: false,
			});
			yield* Effect.promise(() => waitFor(() => expect(premature.failures).toHaveLength(1)));

			const closed = connect();
			closed.pluginPort.postMessage(readyFor(closed.init));
			yield* Effect.promise(() => waitFor(() => expect(closed.readies).toHaveLength(1)));
			closed.session.close();
			closed.pluginPort.postMessage({
				index: 0,
				key: "k0",
				type: "screen-state",
				hasPreviousScreen: true,
			});
			yield* Effect.promise(() => delay(10));

			expect(premature.screenStates).toEqual([]);
			expect(closed.screenStates).toEqual([]);
		}),
	);

	it.live("fails a ready from another session or another artifact", () =>
		Effect.gen(function* () {
			const other = connect();
			other.pluginPort.postMessage({ ...readyFor(other.init), sessionId: "other-session" });
			yield* Effect.promise(() => waitFor(() => expect(other.failures).toHaveLength(1)));

			const mismatched = connect();
			mismatched.pluginPort.postMessage({
				...readyFor(mismatched.init),
				compositionHash: "other-composition",
			});
			yield* Effect.promise(() => waitFor(() => expect(mismatched.failures).toHaveLength(1)));

			expect(other.readies).toEqual([]);
			expect(mismatched.readies).toEqual([]);
		}),
	);

	it.live("fails a malformed, wrong-version, or out-of-order first message", () =>
		Effect.gen(function* () {
			const malformed = connect();
			malformed.pluginPort.postMessage({ sessionId: malformed.init.sessionId });
			yield* Effect.promise(() => waitFor(() => expect(malformed.failures).toHaveLength(1)));

			const outdated = connect();
			outdated.pluginPort.postMessage({ ...readyFor(outdated.init), bridgeVersion: 0 });
			yield* Effect.promise(() => waitFor(() => expect(outdated.failures).toHaveLength(1)));

			const premature = connect();
			premature.pluginPort.postMessage({ mode: "push", target: home, type: "navigate" });
			yield* Effect.promise(() => waitFor(() => expect(premature.failures).toHaveLength(1)));

			expect(premature.navigations).toEqual([]);
		}),
	);

	it.live("honors lifecycle closure before activation without replying with a failure", () =>
		Effect.gen(function* () {
			const disposed = connect();
			disposed.pluginPort.postMessage({ reason: "disposed", type: "lifecycle-close" });
			yield* Effect.promise(() => waitFor(() => expect(disposed.failures).toHaveLength(1)));

			const failed = connect();
			failed.pluginPort.postMessage({ reason: "failed", type: "lifecycle-close" });
			yield* Effect.promise(() => waitFor(() => expect(failed.failures).toHaveLength(1)));

			expect(disposed.received).toEqual([]);
			expect(failed.received).toEqual([]);
		}),
	);

	it.live("fails when the plugin never completes the handshake", () =>
		Effect.gen(function* () {
			const { readies, failures } = connect({ timeoutMs: 10 });

			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));
			expect(readies).toEqual([]);
		}),
	);

	it.live("stops the handshake timeout once the plugin is ready", () =>
		Effect.gen(function* () {
			const { init, readies, failures, pluginPort } = connect({ timeoutMs: 10 });

			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			yield* Effect.promise(() => delay(40));

			expect(failures).toEqual([]);
		}),
	);

	it.live("delivers only the latest pre-ready location, then every later location", () =>
		Effect.gen(function* () {
			const { init, session, received, pluginPort } = connect();

			session.sendLocation(nav(detail, 1));
			session.sendLocation(nav({ kind: "route", path: "/details/2", search: "tab=stats" }, 2));
			pluginPort.postMessage(readyFor(init));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toEqual([
						at({ kind: "route", path: "/details/2", search: "tab=stats" }, 2),
					]),
				),
			);

			session.sendLocation(nav());

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toEqual([
						at({ kind: "route", path: "/details/2", search: "tab=stats" }, 2),
						at(),
					]),
				),
			);
		}),
	);

	it.live("sends an entity location from the kernel to the plugin", () =>
		Effect.gen(function* () {
			const { init, session, received, pluginPort } = connect();

			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toEqual([at()])));

			session.sendLocation(nav(entity, 1));

			yield* Effect.promise(() => waitFor(() => expect(received).toEqual([at(), at(entity, 1)])));
		}),
	);

	it.live("latches a pre-ready theme change and sends later themes on the active channel", () =>
		Effect.gen(function* () {
			const { init, readies, session, messages, pluginPort } = connect();

			session.sendTheme(darkTheme);
			pluginPort.postMessage(readyFor(init));

			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			expect(messages).toEqual([at(), { mode: "dark", type: "theme" }]);

			session.sendTheme(lightTheme);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(messages).toEqual([
						at(),
						{ mode: "dark", type: "theme" },
						{ mode: "light", type: "theme" },
					]),
				),
			);
		}),
	);

	it.live("sends no theme when the pre-ready mode still matches init", () =>
		Effect.gen(function* () {
			const { init, readies, session, messages, pluginPort } = connect();

			session.sendTheme(darkTheme);
			session.sendTheme(lightTheme);
			pluginPort.postMessage(readyFor(init));

			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			expect(messages).toEqual([at()]);
		}),
	);

	it.live("forwards decoded navigation requests once ready", () =>
		Effect.gen(function* () {
			const { init, readies, failures, pluginPort, navigations } = connect();
			const request = {
				mode: "push",
				type: "navigate",
				target: {
					path: "/details/1",
					search: "tab=stats",
					kind: "plugin-route",
					pluginSlug: PluginSlug.make("fixture"),
				},
			} satisfies PluginBridgeNavigate;

			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(readies).toHaveLength(1)));
			pluginPort.postMessage(request);

			yield* Effect.promise(() => waitFor(() => expect(navigations).toEqual([request])));
			expect(failures).toEqual([]);
		}),
	);

	it.live("round-trips a managed asset request and result without identity details", () =>
		Effect.gen(function* () {
			const assets = [{ type: "local", key: "permanent/cover.png" }] as const;
			const resolutions = [
				{
					asset: assets[0],
					expiresAt: "2026-09-04T12:15:00.000Z",
					url: "https://ryot.example/api/uploads/local/download?key=permanent/cover.png",
				},
			] as const;
			const calls: PluginAssetRequest[] = [];
			const { init, received, pluginPort } = connect({
				onAssets: (request) => {
					calls.push(request);
					return Effect.succeed({ resolutions, outcome: "success" });
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({ assets, requestId: "asset-1", type: "asset-request" });

			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
			expect(calls).toEqual([{ assets }]);
			expect(received[1]).toEqual({
				resolutions,
				outcome: "success",
				requestId: "asset-1",
				type: "asset-result",
			});
		}),
	);

	for (const reason of ["asset-failed", "transport"] satisfies PluginAssetBridgeErrorReason[]) {
		it.live(`round-trips an ${reason} asset bridge error without extra details`, () =>
			Effect.gen(function* () {
				const { init, received, failures, pluginPort } = connect({
					onAssets: () => Effect.succeed({ reason, outcome: "failure" }),
				});
				pluginPort.postMessage(readyFor(init));
				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

				pluginPort.postMessage({
					requestId: "asset-1",
					type: "asset-request",
					assets: [{ type: "s3", key: "permanent/cover.png" }],
				});

				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
				expect(received[1]).toEqual({
					reason,
					outcome: "failure",
					requestId: "asset-1",
					type: "asset-result",
				});
				expect(failures).toEqual([]);
			}),
		);
	}

	it.live("rejects an asset request carrying installation or authentication identity", () =>
		Effect.gen(function* () {
			const calls: PluginAssetRequest[] = [];
			const { init, received, failures, pluginPort } = connect({
				onAssets: (request) => {
					calls.push(request);
					return Effect.succeed({ resolutions: [], outcome: "success" });
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				userId: "user-1",
				requestId: "asset-1",
				type: "asset-request",
				installationId: "installation-1",
				authorization: "Bearer private-token",
				assets: [{ type: "local", key: "permanent/cover.png" }],
			});

			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));
			expect(calls).toEqual([]);
			expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live("cancels only matching asset work, releases admission, and ignores late results", () =>
		Effect.gen(function* () {
			const signals: AbortSignal[] = [];
			const calls: Array<ReturnType<typeof deferred<PluginAssetOutcome>>> = [];
			const { init, received, failures, pluginPort } = connect({
				onAssets: () =>
					Effect.promise((signal) => {
						signals.push(signal);
						const call = deferred<PluginAssetOutcome>();
						calls.push(call);
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			for (let index = 0; index < CLIENT_BRIDGE_MAX_PENDING_REQUESTS; index += 1) {
				pluginPort.postMessage({
					type: "asset-request",
					requestId: `asset-${index}`,
					assets: [{ type: "local", key: `permanent/asset-${index}.png` }],
				});
			}
			yield* Effect.promise(() =>
				waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS)),
			);

			pluginPort.postMessage({ requestId: "unknown", type: "asset-cancel" });
			pluginPort.postMessage({ requestId: "asset-0", type: "asset-cancel" });
			pluginPort.postMessage({ requestId: "asset-0", type: "asset-cancel" });
			yield* Effect.promise(() => waitFor(() => expect(signals[0]?.aborted).toBe(true)));

			pluginPort.postMessage({
				type: "asset-request",
				requestId: "replacement",
				assets: [{ type: "s3", key: "permanent/replacement.png" }],
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS + 1)),
			);

			calls[0]?.resolve({ resolutions: [], outcome: "success" });
			calls.at(-1)?.resolve({ resolutions: [], outcome: "success" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						resolutions: [],
						outcome: "success",
						type: "asset-result",
						requestId: "replacement",
					}),
				),
			);

			expect(received).not.toContainEqual(expect.objectContaining({ requestId: "asset-0" }));
			expect(failures).toEqual([]);
		}),
	);

	it.live("aborts pending asset work on disposal and suppresses its late result", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			const call = deferred<PluginAssetOutcome>();
			const { init, session, received, pluginPort } = connect({
				onAssets: () =>
					Effect.promise((requestSignal) => {
						signal = requestSignal;
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));
			pluginPort.postMessage({
				requestId: "asset-1",
				type: "asset-request",
				assets: [{ type: "local", key: "permanent/cover.png" }],
			});
			yield* Effect.promise(() => waitFor(() => expect(signal).toBeDefined()));

			session.close();
			expect(signal?.aborted).toBe(true);
			call.resolve({ resolutions: [], outcome: "success" });
			yield* Effect.promise(() => delay(10));

			expect(received).toEqual([at(), { reason: "disposed", type: "lifecycle-close" }]);
		}),
	);

	it.live("sends only lifecycle close after teardown or a failed handshake", () =>
		Effect.gen(function* () {
			const torndown = connect();
			torndown.session.close();
			torndown.session.sendLocation(nav(detail, 1));

			const failed = connect({ timeoutMs: 10 });
			yield* Effect.promise(() => waitFor(() => expect(failed.failures).toHaveLength(1)));
			failed.session.sendLocation(nav(detail, 1));

			yield* Effect.promise(() => delay(10));

			expect(torndown.received).toEqual([{ reason: "disposed", type: "lifecycle-close" }]);
			expect(failed.received).toEqual([{ reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live("stops delivering after teardown", () =>
		Effect.gen(function* () {
			const { init, readies, session, failures, pluginPort } = connect();

			session.close();
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => delay(10));

			expect(readies).toEqual([]);
			expect(failures).toEqual([]);
		}),
	);

	it.live("honors peer disposal, aborts work, and ignores late admissions", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			const call = deferred<PluginOperationOutcome>();
			const { init, received, pluginPort, navigations } = connect({
				onOperation: () =>
					Effect.promise((requestSignal) => {
						signal = requestSignal;
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));
			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(signal).toBeDefined()));

			pluginPort.postMessage({ reason: "disposed", type: "lifecycle-close" });
			yield* Effect.promise(() => waitFor(() => expect(signal?.aborted).toBe(true)));
			pluginPort.postMessage({ mode: "push", target: home, type: "navigate" });
			call.resolve({ value: "late", outcome: "success" });
			yield* Effect.promise(() => delay(10));

			expect(navigations).toEqual([]);
			expect(received).toEqual([at()]);
		}),
	);

	it.live("round-trips a successful operation", () =>
		Effect.gen(function* () {
			const calls: PluginOperationRequest[] = [];
			const { init, received, pluginPort } = connect({
				onOperation: (request) => {
					calls.push(request);
					return Effect.succeed({ value: "ok", outcome: "success" });
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
				input: { greeting: "hi" },
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						value: "ok",
						outcome: "success",
						requestId: "request-1",
						type: "operation-result",
					}),
				),
			);
			expect(calls).toEqual([
				{
					operationSlug: "greet",
					input: { greeting: "hi" },
					pluginSlug: PluginSlug.make("fixture"),
				},
			]);
		}),
	);

	it.live("round-trips a collection mutation and sanitizes invalid outcomes", () =>
		Effect.gen(function* () {
			const calls: PluginCollectionRequest[] = [];
			let count = 0;
			const redactedFailure = { cause: "secret", reason: "private", outcome: "failure" };
			const { init, received, failures, pluginPort } = connect({
				onCollection: (request) => {
					calls.push(request);
					count += 1;
					return Effect.succeed(
						count === 1
							? { outcome: "success", response: membership }
							: // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- verifies runtime detail redaction
								(redactedFailure as unknown as PluginCollectionOutcome),
					);
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			const request = {
				requestId: "collection-1",
				type: "collection-request" as const,
				action: "upsert-membership" as const,
				input: { entityId: "entity-1", collectionId: "collection-1" },
			};
			pluginPort.postMessage(request);
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
			expect(received[1]).toMatchObject({
				outcome: "success",
				requestId: "collection-1",
				type: "collection-result",
			});
			expect(calls).toEqual([{ input: request.input, action: request.action }]);

			pluginPort.postMessage({ ...request, requestId: "collection-2" });
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(3)));
			expect(received[2]).toEqual({
				outcome: "failure",
				reason: "transport",
				requestId: "collection-2",
				type: "collection-result",
			});
			expect(failures).toEqual([]);
		}),
	);

	it.live("round-trips storage requests and sanitizes invalid outcomes", () =>
		Effect.gen(function* () {
			const calls: PluginStorageRequest[] = [];
			const outcomes: PluginStorageOutcome[] = [
				{ outcome: "success", value: { order: "aired" } },
				{ reason: "quota", outcome: "failure" },
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- verifies runtime detail redaction
				{ reason: "private", outcome: "failure" } as unknown as PluginStorageOutcome,
			];
			const { init, received, failures, pluginPort } = connect({
				onStorage: (request) => {
					calls.push(request);
					const outcome = outcomes.shift();
					return outcome === undefined ? Effect.die("unexpected") : Effect.succeed(outcome);
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			const request = { key: "order", pluginSlug: "media", type: "storage-request" as const };
			pluginPort.postMessage({ ...request, action: "get", requestId: "storage-1" });
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
			expect(received[1]).toEqual({
				outcome: "success",
				requestId: "storage-1",
				type: "storage-result",
				value: { order: "aired" },
			});

			pluginPort.postMessage({ ...request, value: 1, action: "set", requestId: "storage-2" });
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(3)));
			expect(received[2]).toEqual({
				reason: "quota",
				outcome: "failure",
				requestId: "storage-2",
				type: "storage-result",
			});

			pluginPort.postMessage({ ...request, action: "remove", requestId: "storage-3" });
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(4)));
			expect(received[3]).toEqual({
				outcome: "failure",
				reason: "transport",
				requestId: "storage-3",
				type: "storage-result",
			});
			expect(calls).toEqual([
				{ key: "order", action: "get", pluginSlug: "media" },
				{ value: 1, key: "order", action: "set", pluginSlug: "media" },
				{ key: "order", action: "remove", pluginSlug: "media" },
			]);
			expect(failures).toEqual([]);
		}),
	);

	it.live("round-trips an upload and hands the source to the host untouched", () =>
		Effect.gen(function* () {
			const calls: PluginUploadRequest[] = [];
			const token = { token: "upload-token", expiresAt: "2026-01-01T00:15:00.000Z" };
			const { init, received, pluginPort } = connect({
				onUpload: (request) => {
					calls.push(request);
					return Effect.succeed({ token, outcome: "success" });
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				fileName: "items.csv",
				requestId: "upload-1",
				type: "upload-request",
				contentType: "text/csv",
				source: new Blob(["id,title"], { type: "text/csv" }),
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						token,
						outcome: "success",
						requestId: "upload-1",
						type: "upload-result",
					}),
				),
			);
			expect(calls).toHaveLength(1);
			const uploaded = calls[0];
			expect(uploaded).toMatchObject({ fileName: "items.csv", contentType: "text/csv" });
			expect(uploaded.source).toBeInstanceOf(Blob);
			expect(yield* Effect.promise(() => uploaded.source.text())).toBe("id,title");
		}),
	);

	it.live("reports upload failures and rejects a source that is not a Blob", () =>
		Effect.gen(function* () {
			const { init, received, failures, pluginPort } = connect({
				onUpload: () => Effect.die("upload exploded"),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				fileName: "items.csv",
				requestId: "upload-1",
				type: "upload-request",
				contentType: "text/csv",
				source: new Blob(["id,title"]),
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						outcome: "failure",
						reason: "transport",
						type: "upload-result",
						requestId: "upload-1",
					}),
				),
			);

			pluginPort.postMessage({
				source: {},
				requestId: "upload-2",
				fileName: "items.csv",
				type: "upload-request",
				contentType: "text/csv",
			});
			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));
		}),
	);

	it.live("maps synchronous operation and query failures to transport results", () =>
		Effect.gen(function* () {
			const { init, received, pluginPort } = connect({
				onRyotQL: () => {
					throw new Error("query failed synchronously");
				},
				onOperation: () => {
					throw new Error("operation failed synchronously");
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				operationSlug: "greet",
				requestId: "operation-1",
				type: "operation-request",
			});
			pluginPort.postMessage({ document, requestId: "query-1", type: "ryotql-request" });

			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(3)));
			expect(received).toContainEqual({
				outcome: "failure",
				reason: "transport",
				requestId: "operation-1",
				type: "operation-result",
			});
			expect(received).toContainEqual({
				outcome: "failure",
				reason: "transport",
				requestId: "query-1",
				type: "ryotql-result",
			});
		}),
	);

	it.live("maps an invalid operation success to malformed-result and keeps the session alive", () =>
		Effect.gen(function* () {
			let calls = 0;
			const { init, received, failures, pluginPort } = connect({
				onOperation: () => {
					calls += 1;
					return Effect.succeed(
						calls === 1
							? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- injects an invalid runtime boundary value
								({
									outcome: "success",
									value: () => undefined,
								} as unknown as PluginOperationOutcome)
							: { value: "ok", outcome: "success" },
					);
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						outcome: "failure",
						requestId: "request-1",
						type: "operation-result",
						reason: "malformed-result",
					}),
				),
			);
			pluginPort.postMessage({
				input: null,
				requestId: "request-2",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						value: "ok",
						outcome: "success",
						requestId: "request-2",
						type: "operation-result",
					}),
				),
			);
			expect(failures).toEqual([]);
		}),
	);

	for (const reason of [
		"transport",
		"operation-failed",
		"malformed-result",
	] satisfies PluginOperationBridgeErrorReason[]) {
		it.live(`round-trips a ${reason} operation bridge error without extra details`, () =>
			Effect.gen(function* () {
				const { init, received, failures, pluginPort } = connect({
					onOperation: () =>
						Effect.succeed(
							// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- verifies runtime detail redaction
							{ reason, outcome: "failure", cause: new Error("private") } as PluginOperationOutcome,
						),
				});
				pluginPort.postMessage(readyFor(init));
				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

				pluginPort.postMessage({
					input: null,
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
				});

				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
				expect(received[1]).toEqual({
					reason,
					outcome: "failure",
					requestId: "request-1",
					type: "operation-result",
				});
				expect(failures).toEqual([]);
			}),
		);
	}

	it.live("maps an invalid callback failure reason to transport", () =>
		Effect.gen(function* () {
			const { init, received, pluginPort } = connect({
				onOperation: () =>
					Effect.succeed(
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- injects an invalid runtime boundary value
						{ outcome: "failure", reason: "private-failure" } as unknown as PluginOperationOutcome,
					),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});

			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
			expect(received[1]).toEqual({
				outcome: "failure",
				reason: "transport",
				requestId: "request-1",
				type: "operation-result",
			});
		}),
	);

	it.live("reports a transport failure when onOperation rejects", () =>
		Effect.gen(function* () {
			const { init, received, pluginPort } = connect({ onOperation: () => Effect.die("boom") });
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						outcome: "failure",
						reason: "transport",
						requestId: "request-1",
						type: "operation-result",
					}),
				),
			);
			expect(received).toHaveLength(2);
		}),
	);

	it.live("settles two concurrent calls out of order, each exactly once", () =>
		Effect.gen(function* () {
			const calls: Array<ReturnType<typeof deferred<PluginOperationOutcome>>> = [];
			const { init, received, pluginPort } = connect({
				onOperation: () => {
					const call = deferred<PluginOperationOutcome>();
					calls.push(call);
					return Effect.promise(() => call.promise);
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: "a",
				requestId: "request-a",
				operationSlug: "greet",
				type: "operation-request",
			});
			pluginPort.postMessage({
				input: "b",
				requestId: "request-b",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(calls).toHaveLength(2)));

			calls[1]?.resolve({ value: "b-value", outcome: "success" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						value: "b-value",
						outcome: "success",
						requestId: "request-b",
						type: "operation-result",
					}),
				),
			);

			calls[0]?.resolve({ value: "a-value", outcome: "success" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						value: "a-value",
						outcome: "success",
						requestId: "request-a",
						type: "operation-result",
					}),
				),
			);

			expect(received).toHaveLength(3);
		}),
	);

	it.live("ignores a second request that reuses an in-flight request id", () =>
		Effect.gen(function* () {
			const calls: Array<ReturnType<typeof deferred<PluginOperationOutcome>>> = [];
			const { init, received, pluginPort } = connect({
				onOperation: () => {
					const call = deferred<PluginOperationOutcome>();
					calls.push(call);
					return Effect.promise(() => call.promise);
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: "a",
				requestId: "request-a",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(calls).toHaveLength(1)));

			pluginPort.postMessage({
				input: "a-again",
				requestId: "request-a",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => delay(10));

			expect(calls).toHaveLength(1);
			calls[0]?.resolve({ value: "a-value", outcome: "success" });

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						value: "a-value",
						outcome: "success",
						requestId: "request-a",
						type: "operation-result",
					}),
				),
			);
			expect(received).toHaveLength(2);
		}),
	);

	it.live("fails the session when aggregate pending requests exceed the admission limit", () =>
		Effect.gen(function* () {
			const signals: AbortSignal[] = [];
			const { init, received, failures, pluginPort } = connect({
				onRyotQL: () =>
					Effect.promise((signal) => {
						signals.push(signal);
						// oxlint-disable-next-line effecttsgo/new-promise -- This test keeps the injected host request pending to verify cancellation or admission.
						return new Promise<never>(() => {});
					}),
				onOperation: () =>
					Effect.promise((signal) => {
						signals.push(signal);
						// oxlint-disable-next-line effecttsgo/new-promise -- This test keeps the injected host request pending to verify cancellation or admission.
						return new Promise<never>(() => {});
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			for (let index = 0; index < CLIENT_BRIDGE_MAX_PENDING_REQUESTS; index += 1) {
				if (index % 2 === 0) {
					pluginPort.postMessage({
						input: null,
						operationSlug: "greet",
						type: "operation-request",
						requestId: `request-${index}`,
					});
				} else {
					pluginPort.postMessage({
						document,
						type: "ryotql-request",
						requestId: `request-${index}`,
					});
				}
			}
			yield* Effect.promise(() =>
				waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS)),
			);

			pluginPort.postMessage({ document, requestId: "overflow", type: "ryotql-request" });
			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));

			expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(signals.every((signal) => signal.aborted)).toBe(true);
			expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live("fails the session on a malformed active-port message and suppresses late work", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			const call = deferred<PluginOperationOutcome>();
			const { init, received, failures, pluginPort } = connect({
				onOperation: () =>
					Effect.promise((requestSignal) => {
						signal = requestSignal;
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(signal).toBeDefined()));

			pluginPort.postMessage({
				requestId: "malformed",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));
			expect(signal?.aborted).toBe(true);

			call.resolve({ value: "late", outcome: "success" });
			yield* Effect.promise(() => delay(10));

			expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live.each([
		["untagged", { search: "", path: "/details/1" }],
		["entity-shaped", { kind: "entity", entityId: "entity-1", entitySchemaSlug: "show" }],
	] as const)("fails an %s plugin navigation message", (_label, target) =>
		Effect.gen(function* () {
			const { init, received, failures, pluginPort, navigations } = connect();
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toEqual([at()])));

			pluginPort.postMessage({ target, mode: "push", type: "navigate" });

			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));
			expect(navigations).toEqual([]);
			expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live(
		"aborts pending operation and RyotQL work on failure and suppresses both late results",
		() =>
			Effect.gen(function* () {
				let operationSignal: AbortSignal | undefined;
				let querySignal: AbortSignal | undefined;
				const operationCall = deferred<PluginOperationOutcome>();
				const queryCall = deferred<PluginRyotQLOutcome>();
				const { init, received, failures, pluginPort } = connect({
					onRyotQL: () =>
						Effect.promise((signal) => {
							querySignal = signal;
							return queryCall.promise;
						}),
					onOperation: () =>
						Effect.promise((signal) => {
							operationSignal = signal;
							return operationCall.promise;
						}),
				});
				pluginPort.postMessage(readyFor(init));
				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

				pluginPort.postMessage({
					input: null,
					operationSlug: "greet",
					requestId: "operation-1",
					type: "operation-request",
				});
				pluginPort.postMessage({ document, requestId: "query-1", type: "ryotql-request" });
				yield* Effect.promise(() =>
					waitFor(() => {
						expect(querySignal).toBeDefined();
						expect(operationSignal).toBeDefined();
					}),
				);

				pluginPort.postMessage({ type: "unknown-message" });
				yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));
				expect(operationSignal?.aborted).toBe(true);
				expect(querySignal?.aborted).toBe(true);

				operationCall.resolve({ outcome: "success", value: "late-operation" });
				queryCall.resolve({ outcome: "success", response: { data: {} } });
				yield* Effect.promise(() => delay(10));

				expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
			}),
	);

	it.live("fails the session before invoking an operation with extra identity fields", () =>
		Effect.gen(function* () {
			const { init, received, failures, pluginPort, operationCalls } = connect();
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
				installationId: "installation-2",
			});
			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));

			expect(operationCalls).toEqual([]);
			expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live("aborts pending signals on close and posts nothing after a late resolution", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			const call = deferred<PluginOperationOutcome>();
			const { init, session, received, pluginPort } = connect({
				onOperation: () =>
					Effect.promise((requestSignal) => {
						signal = requestSignal;
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(signal).toBeDefined()));

			session.close();
			expect(signal?.aborted).toBe(true);

			call.resolve({ value: "too-late", outcome: "success" });
			yield* Effect.promise(() => delay(10));

			expect(received).toEqual([at(), { reason: "disposed", type: "lifecycle-close" }]);
		}),
	);

	it.live("correlates concurrent RyotQL requests completed out of order", () =>
		Effect.gen(function* () {
			const calls: Array<ReturnType<typeof deferred<PluginRyotQLOutcome>>> = [];
			const { init, received, pluginPort } = connect({
				onRyotQL: () => {
					const call = deferred<PluginRyotQLOutcome>();
					calls.push(call);
					return Effect.promise(() => call.promise);
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({ document, requestId: "query-a", type: "ryotql-request" });
			pluginPort.postMessage({ document, requestId: "query-b", type: "ryotql-request" });
			yield* Effect.promise(() => waitFor(() => expect(calls).toHaveLength(2)));

			calls[1]?.resolve({ outcome: "success", response: { data: {} } });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						outcome: "success",
						requestId: "query-b",
						type: "ryotql-result",
						response: { data: {} },
					}),
				),
			);
			calls[0]?.resolve({ outcome: "failure", reason: "query-failed" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						outcome: "failure",
						requestId: "query-a",
						type: "ryotql-result",
						reason: "query-failed",
					}),
				),
			);
			expect(received).toHaveLength(3);
		}),
	);

	it.live("rejects duplicate in-flight IDs across query and operation requests", () =>
		Effect.gen(function* () {
			const query = deferred<PluginRyotQLOutcome>();
			const operationCalls: PluginOperationRequest[] = [];
			const { init, received, pluginPort } = connect({
				onRyotQL: () => Effect.promise(() => query.promise),
				onOperation: (request) => {
					operationCalls.push(request);
					return Effect.succeed({ value: null, outcome: "success" });
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({ document, requestId: "shared-id", type: "ryotql-request" });
			pluginPort.postMessage({
				input: null,
				requestId: "shared-id",
				operationSlug: "greet",
				type: "operation-request",
			});
			yield* Effect.promise(() => delay(10));

			expect(operationCalls).toEqual([]);
			query.resolve({ outcome: "success", response: { data: {} } });
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(2)));
		}),
	);

	it.live("fails the session on a malformed RyotQL request", () =>
		Effect.gen(function* () {
			const calls: PluginRyotQLRequest[] = [];
			const { init, received, failures, pluginPort } = connect({
				onRyotQL: (request) => {
					calls.push(request);
					return Effect.succeed({ outcome: "success", response: { data: {} } });
				},
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			pluginPort.postMessage({
				document,
				userId: "user-1",
				requestId: "query-a",
				type: "ryotql-request",
			});
			yield* Effect.promise(() => waitFor(() => expect(failures).toHaveLength(1)));

			expect(calls).toEqual([]);
			expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
		}),
	);

	it.live("aborts a pending RyotQL request and suppresses its late response", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			const call = deferred<PluginRyotQLOutcome>();
			const { init, session, received, pluginPort } = connect({
				onRyotQL: () =>
					Effect.promise((requestSignal) => {
						signal = requestSignal;
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));
			pluginPort.postMessage({ document, requestId: "query-a", type: "ryotql-request" });
			yield* Effect.promise(() => waitFor(() => expect(signal).toBeDefined()));

			session.close();
			expect(signal?.aborted).toBe(true);
			call.resolve({ outcome: "failure", reason: "transport" });
			yield* Effect.promise(() => delay(10));

			expect(received).toEqual([at(), { reason: "disposed", type: "lifecycle-close" }]);
		}),
	);

	it.live("cancels matching RyotQL work, releases admission, and ignores cancellation races", () =>
		Effect.gen(function* () {
			const signals: AbortSignal[] = [];
			const calls: Array<ReturnType<typeof deferred<PluginRyotQLOutcome>>> = [];
			const { init, received, failures, pluginPort } = connect({
				onRyotQL: () =>
					Effect.promise((signal) => {
						signals.push(signal);
						const call = deferred<PluginRyotQLOutcome>();
						calls.push(call);
						return call.promise;
					}),
			});
			pluginPort.postMessage(readyFor(init));
			yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

			for (let index = 0; index < CLIENT_BRIDGE_MAX_PENDING_REQUESTS; index += 1) {
				pluginPort.postMessage({ document, type: "ryotql-request", requestId: `query-${index}` });
			}
			yield* Effect.promise(() =>
				waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS)),
			);

			pluginPort.postMessage({ requestId: "unknown", type: "ryotql-cancel" });
			pluginPort.postMessage({ requestId: "query-0", type: "ryotql-cancel" });
			pluginPort.postMessage({ requestId: "query-0", type: "ryotql-cancel" });
			yield* Effect.promise(() => waitFor(() => expect(signals[0]?.aborted).toBe(true)));
			pluginPort.postMessage({ document, type: "ryotql-request", requestId: "replacement" });
			yield* Effect.promise(() =>
				waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS + 1)),
			);

			calls[0]?.resolve({ outcome: "success", response: { data: {} } });
			calls.at(-1)?.resolve({ outcome: "success", response: { data: {} } });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(received).toContainEqual({
						outcome: "success",
						type: "ryotql-result",
						response: { data: {} },
						requestId: "replacement",
					}),
				),
			);

			expect(received).not.toContainEqual(expect.objectContaining({ requestId: "query-0" }));
			expect(failures).toEqual([]);
		}),
	);

	it.live(
		"never posts a Ryot credential, identity, or scope value to the plugin across a full session",
		() =>
			Effect.gen(function* () {
				const { init, session, received, pluginPort } = connect({
					onOperation: (request) =>
						Effect.succeed(
							request.operationSlug === "fail"
								? ({ outcome: "failure", reason: "operation-failed" } as const)
								: ({ outcome: "success", value: { echoed: request.input } } as const),
						),
				});
				pluginPort.postMessage(readyFor(init));
				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(1)));

				session.sendLocation(nav({ kind: "route", path: "/details/1", search: "tab=stats" }, 1));

				pluginPort.postMessage({
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
					input: { greeting: "hi" },
				});
				pluginPort.postMessage({
					input: null,
					operationSlug: "fail",
					requestId: "request-2",
					type: "operation-request",
				});

				yield* Effect.promise(() => waitFor(() => expect(received).toHaveLength(4)));

				expect(received).toEqual([
					at(),
					at({ kind: "route", path: "/details/1", search: "tab=stats" }, 1),
					{
						outcome: "success",
						requestId: "request-1",
						type: "operation-result",
						value: { echoed: { greeting: "hi" } },
					},
					{
						outcome: "failure",
						requestId: "request-2",
						type: "operation-result",
						reason: "operation-failed",
					},
				]);
			}),
	);
});
