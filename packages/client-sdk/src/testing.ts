import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	ClientPageContext,
	PluginBridgeClientMessage,
	PluginEntityLocation,
	type PluginAssetOutcome,
	type PluginBridgeHostMessage,
	type PluginBridgeLocation,
	type PluginLogicalLocation,
	type PluginRouteLocation,
	type PluginRyotQLOutcome,
} from "@ryot-app/client-plugin-contract";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { Fragment, act, createElement, type ComponentType } from "react";

import { createRyotClient, type RyotClientAdapter } from "./index";
import { createPluginNavigationStore, type PluginRouterNavigation } from "./navigation/store";
import { bootstrapClientPage } from "./plugin";
import {
	RyotClientService,
	RyotNavigationService,
	RyotScheduleService,
	setBootstrapRyotRuntimeFactory,
} from "./schedule";

// Fills only the required capabilities, so tests of a missing optional one still see
// `unsupported-capability`.
export const createTestRyotAdapter = (
	overrides: Partial<RyotClientAdapter> = {},
): RyotClientAdapter => ({
	query: () => Promise.resolve({}),
	uploadTemporary: () =>
		Promise.resolve({ token: "test-upload-token", expiresAt: "2026-01-01T00:00:00.000Z" }),
	...overrides,
});

// `TestClock.adjust` opens each due sleep's latch and yields once, which is enough for a
// synchronous callback but not for the promise chain `createEntityRefresh` starts. One real
// macrotask turn drains the whole microtask queue, including links enqueued while draining.
const drainMicrotasks = Effect.promise(
	() => new Promise<void>((resolve) => setTimeout(resolve, 0)),
);

export const advanceRyotSchedule = (millis: Duration.Input): Effect.Effect<void> =>
	Effect.andThen(TestClock.adjust(millis), drainMicrotasks);

/** Used by runtimes whose test never mounts a `PluginRouter`. */
const inertNavigation = (): PluginRouterNavigation => {
	const store = createPluginNavigationStore(() => ({
		params: {},
		element: createElement(Fragment),
	}));
	return {
		back: () => undefined,
		subscribe: store.subscribe,
		openDrawer: () => undefined,
		publishTitle: () => undefined,
		getSnapshot: store.getSnapshot,
		registerShortcut: () => () => undefined,
		completeTransition: store.completeTransition,
	};
};

/**
 * A `RyotSchedule` backed by a `TestClock`, plus the runtime `RyotProvider` needs. Pass `navigation`
 * to drive a mounted `PluginRouter`. While the harness is alive, `bootstrapClientPlugin` and
 * `bootstrapClientPage` also build their SDK runtime on this schedule, so `advance` drives
 * bootstrapped pages too.
 */
export const createTestRyotClock = (
	overrides: Partial<RyotClientAdapter> = {},
	navigation: PluginRouterNavigation = inertNavigation(),
) => {
	const client = createRyotClient(createTestRyotAdapter(overrides));
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			RyotClientService.layer(client),
			RyotNavigationService.layer(navigation),
			// `provideMerge`, not `provide`: the test clock must stay in the runtime's output context
			// so `runtime.runPromise(TestClock.adjust(...))` reaches the same instance.
			Layer.provideMerge(RyotScheduleService.layer, TestClock.layer({ warningDelay: "1 hour" })),
		),
	);
	const schedule = runtime.runSync(RyotScheduleService);
	setBootstrapRyotRuntimeFactory((bootstrapClient, bootstrapNavigation) =>
		ManagedRuntime.make(
			Layer.mergeAll(
				RyotClientService.layer(bootstrapClient),
				RyotNavigationService.layer(bootstrapNavigation),
				Layer.succeed(RyotScheduleService, schedule),
			),
		),
	);
	return {
		client,
		runtime,
		dispose: async () => {
			setBootstrapRyotRuntimeFactory(undefined);
			await runtime.dispose();
		},
		advance: (millis: Duration.Input) =>
			act(async () => {
				await runtime.runPromise(advanceRyotSchedule(millis));
			}),
		setTime: (timestamp: number) =>
			act(async () => {
				await runtime.runPromise(Effect.andThen(TestClock.setTime(timestamp), drainMicrotasks));
			}),
	};
};

const artifactMetadata = {
	hash: "test-artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

const decodeClientMessage = Schema.decodeUnknownResult(PluginBridgeClientMessage);

export const routeLocation = (path: string, search = ""): PluginRouteLocation => ({
	path,
	search,
	kind: "route",
});

export const entityLocation = (
	entityId: string,
	entitySchemaSlug: string,
	search = "",
): PluginEntityLocation =>
	Schema.decodeUnknownSync(PluginEntityLocation)({
		search,
		entityId,
		kind: "entity",
		entitySchemaSlug,
	});

export const entityPageContext = (options: {
	readonly pluginId: string;
	readonly entityId: string;
	readonly exportName: string;
	readonly entitySchemaSlug: string;
	readonly params?: Record<string, string> | undefined;
	readonly settings?: Record<string, unknown> | undefined;
}): ClientPageContext =>
	Schema.decodeUnknownSync(ClientPageContext)({
		view: null,
		dataSources: null,
		settings: options.settings ?? {},
		route: { params: options.params ?? {} },
		renderer: { kind: "plugin", pluginId: options.pluginId, exportName: options.exportName },
		target: {
			kind: "entity",
			entityId: options.entityId,
			entitySchemaPluginId: options.pluginId,
			entitySchemaSlug: options.entitySchemaSlug,
		},
	});

export const savedViewPageContext = (options: {
	readonly savedViewId: string;
	readonly rendererName: string;
	readonly settings: Record<string, unknown>;
	readonly dataSources: Record<string, unknown>;
	readonly view?: { readonly name: string; readonly icon: string } | undefined;
}): ClientPageContext =>
	Schema.decodeUnknownSync(ClientPageContext)({
		route: { params: {} },
		settings: options.settings,
		dataSources: options.dataSources,
		renderer: { kind: "kernel", name: options.rendererName },
		view: options.view ?? { icon: "library", name: "All Records" },
		target: { kind: "saved-view", savedViewId: options.savedViewId },
	});

const mounted: Array<{ dispose: () => void }> = [];

export const disposePluginBridges = () => {
	while (mounted.length > 0) {
		mounted.pop()?.dispose();
	}
};

/**
 * Boots `component` the way the kernel does: embedded artifact metadata, a `MessagePort` bridge
 * handshake, and an optional first location. Everything below the bridge — the route resolver,
 * `PluginRouter`, `usePluginLocation`, `useRyotQuery`, `PluginScreenFrame` — stays real, so tests
 * assert on the messages the page actually puts on the port.
 */
export const mountPluginPage = (
	component: ComponentType,
	options: {
		readonly page?: ClientPageContext | undefined;
		readonly location?: PluginLogicalLocation | undefined;
	} = {},
) => {
	document.body.innerHTML = `<div id="${CLIENT_ARTIFACT_ROOT_ELEMENT_ID}"></div>`;
	const metadataElement = document.createElement("script");
	metadataElement.type = "application/json";
	metadataElement.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
	metadataElement.textContent = JSON.stringify(artifactMetadata);
	document.head.append(metadataElement);

	const bootstrap = bootstrapClientPage(component);
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	window.dispatchEvent(
		new MessageEvent("message", {
			source: window.parent,
			ports: [channel.port2],
			data: {
				mode: "light",
				safeAreaTop: 0,
				safeAreaBottom: 0,
				page: options.page,
				sessionId: "test-session",
				format: artifactMetadata.format,
				artifactHash: artifactMetadata.hash,
				apiVersion: artifactMetadata.apiVersion,
				bridgeVersion: artifactMetadata.bridgeVersion,
				compilerVersion: artifactMetadata.compilerVersion,
			},
		}),
	);

	const send = (message: PluginBridgeHostMessage) => channel.port1.postMessage(message);
	const navigate = (
		location: PluginLogicalLocation,
		overrides: Partial<Omit<PluginBridgeLocation, "location" | "type">> = {},
	) =>
		send({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			...overrides,
			location,
		});
	// `PluginBridgeReady` is not a member of the client union, so the handshake message drops out
	// here by design; `messages` keeps every raw payload for tests that need it.
	const clientMessages = () =>
		messages
			.map((message) => decodeClientMessage(message))
			.filter(Result.isSuccess)
			.map((decoded) => decoded.success);
	const clientMessagesOfType = <TType extends PluginBridgeClientMessage["type"]>(type: TType) =>
		clientMessages().filter(
			(message): message is Extract<PluginBridgeClientMessage, { readonly type: TType }> =>
				message.type === type,
		);

	const page = {
		send,
		messages,
		navigate,
		clientMessages,
		assetCancels: () => clientMessagesOfType("asset-cancel"),
		assetRequests: () => clientMessagesOfType("asset-request"),
		container: document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID),
		replyAssets: (requestId: string, outcome: PluginAssetOutcome) =>
			send({ ...outcome, requestId, type: "asset-result" }),
		replyQuery: (requestId: string, outcome: PluginRyotQLOutcome) =>
			send({ ...outcome, requestId, type: "ryotql-result" }),
		queryRequests: (queryKey?: string) =>
			clientMessagesOfType("ryotql-request").filter(
				(request) => queryKey === undefined || queryKey in request.document.queries,
			),
		dispose: () => {
			const index = mounted.indexOf(page);
			if (index >= 0) {
				mounted.splice(index, 1);
			}
			bootstrap.dispose();
			channel.port1.close();
			channel.port2.close();
			document.head.innerHTML = "";
			document.body.innerHTML = "";
		},
	};
	mounted.push(page);
	if (options.location !== undefined) {
		navigate(options.location);
	}
	return page;
};
