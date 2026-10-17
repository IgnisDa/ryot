import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	ClientPageContext,
	isPageShortcut,
	KERNEL_SHORTCUTS,
	KernelShortcut,
	MAX_PAGE_SHORTCUTS,
	PLUGIN_STORAGE_KEY_MAX_LENGTH,
	PluginAssetBridgeErrorReason,
	PluginAssetOutcome,
	PluginAssetRequest,
	PluginBridgeAddToCollectionScreen,
	PluginBridgeAddToCollectionScreenResult,
	PluginBridgeAssetCancel,
	PluginBridgeAssetRequest,
	PluginBridgeAssetResult,
	PluginBridgeClientMessage,
	PluginBridgeCollectionResult,
	type PluginBridgeDismissOverlay,
	type PluginBridgeDismissOverlayResult,
	PluginBridgeEditCollectionScreen,
	PluginBridgeEditCollectionScreenResult,
	PluginBridgeHostMessage,
	PluginBridgeInit,
	PluginBridgeOperationResult,
	type PluginBridgeOverlayState,
	PluginBridgePageRefresh,
	PluginBridgePageSearch,
	PluginBridgePickEntityScreen,
	PluginBridgePickEntityScreenResult,
	PluginBridgeReady,
	PluginBridgeRyotQLCancel,
	PluginBridgeRyotQLResult,
	PluginBridgeStorageResult,
	PluginBridgeUploadResult,
	PluginClientArtifact,
	PluginClientArtifactFromBase64,
	PluginCollectionRequest,
	PluginLeadingIntent,
	PluginManagedAssetResolution,
	PluginNavigationTarget,
	PluginOperationBridgeErrorReason,
	PluginRyotQLFailureReason,
	PluginThemeSnapshot,
	RyotClientErrorReason,
} from "./index";

const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 10 } },
		},
	},
} as const;

const identity = {
	sessionId: "session-1",
	compositionHash: "hash-1",
	apiVersion: CLIENT_API_VERSION,
	format: CLIENT_ARTIFACT_FORMAT,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

describe("plugin client artifact contract", () => {
	const packageFields = {
		imports: [],
		packageId: "test/client",
		clientDeclarationHash: "declaration-hash",
	};
	it("decodes canonical Base64 contents while retaining artifact validation", () => {
		const decode = Schema.decodeUnknownResult(PluginClientArtifactFromBase64);
		const artifact = {
			...packageFields,
			hash: "hash",
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		};
		const decoded = decode({
			...artifact,
			files: [{ contents: "/wA=", name: "plugin.js", contentType: "text/javascript" }],
		});
		expect(Result.isSuccess(decoded)).toBe(true);
		if (Result.isSuccess(decoded)) {
			expect(decoded.success.files[0]?.contents).toEqual(new Uint8Array([0xff, 0x00]));
		}
		expect(
			Result.isFailure(
				decode({
					...artifact,
					files: [
						{ contents: "/wA=", name: "plugin.js", contentType: "text/javascript" },
						{ contents: "/wA=", name: "plugin.js", contentType: "text/javascript" },
					],
				}),
			),
		).toBe(true);
	});

	it("rejects duplicate emitted file names", () => {
		const decode = Schema.decodeUnknownResult(PluginClientArtifact);
		const file = { name: "plugin.js", contents: new Uint8Array(), contentType: "text/javascript" };

		expect(
			Result.isFailure(
				decode({
					...packageFields,
					hash: "hash",
					files: [file, file],
					format: CLIENT_ARTIFACT_FORMAT,
					apiVersion: CLIENT_API_VERSION,
					compilerVersion: CLIENT_COMPILER_VERSION,
					bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
				}),
			),
		).toBe(true);
	});

	it("requires artifact file contents to be bytes", () => {
		const decode = Schema.decodeUnknownResult(PluginClientArtifact);
		const artifact = {
			...packageFields,
			hash: "hash",
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		};

		expect(
			Result.isSuccess(
				decode({
					...artifact,
					files: [
						{ name: "plugin.js", contentType: "text/javascript", contents: new Uint8Array([0xff]) },
					],
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					...artifact,
					files: [{ contents: "", name: "plugin.js", contentType: "text/javascript" }],
				}),
			),
		).toBe(true);
	});
});

describe("plugin client bridge contract", () => {
	it("admits only bounded, strict entity interest and update messages in their direction", () => {
		const client = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const host = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const interest = {
			foreground: ["root"],
			type: "entity-watches",
			visible: Array.from({ length: 499 }, (_, i) => `row-${i}`),
		};
		const update = { entityId: "root", reason: "translated", type: "entity-updated" };
		expect(Result.isSuccess(client(interest))).toBe(true);
		expect(Result.isSuccess(host(update))).toBe(true);
		expect(Result.isFailure(host(interest))).toBe(true);
		expect(Result.isFailure(client(update))).toBe(true);
		expect(Result.isFailure(client({ ...interest, foreground: ["root", "extra"] }))).toBe(true);
		for (const extra of [
			{ ticket: "secret" },
			{ requestId: "1" },
			{ userId: "user" },
			{ server: "url" },
		]) {
			expect(Result.isFailure(client({ ...interest, ...extra }))).toBe(true);
			expect(Result.isFailure(host({ ...update, ...extra }))).toBe(true);
		}
		expect(Result.isFailure(host({ ...update, reason: "changed" }))).toBe(true);
		expect(Result.isFailure(client({ ...interest, foreground: [123] }))).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(PluginBridgeReady)({ ...identity, bridgeVersion: 6 }),
			),
		).toBe(true);
	});

	it("pins the API, protocol, and compiler versions it stamps into an artifact", () => {
		expect(CLIENT_API_VERSION).toBe(1);
		expect(CLIENT_BRIDGE_PROTOCOL_VERSION).toBe(1);
		expect(CLIENT_COMPILER_VERSION).toBe(1);
	});

	it("admits strict overlay state, dismissal, and acknowledgement messages in one direction", () => {
		const client = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const host = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const state = { count: 2, type: "overlay-state" } satisfies PluginBridgeOverlayState;
		const request = {
			requestId: "overlay-1",
			type: "dismiss-overlay",
		} satisfies PluginBridgeDismissOverlay;
		const result = {
			dismissed: true,
			requestId: "overlay-1",
			type: "dismiss-overlay-result",
		} satisfies PluginBridgeDismissOverlayResult;

		expect(Result.isSuccess(client(state))).toBe(true);
		expect(Result.isSuccess(client(result))).toBe(true);
		expect(Result.isSuccess(host(request))).toBe(true);
		expect(Result.isFailure(host(state))).toBe(true);
		expect(Result.isFailure(client(request))).toBe(true);
		expect(Result.isFailure(client({ ...state, count: -1 }))).toBe(true);
		expect(Result.isFailure(client({ ...result, extra: true }))).toBe(true);
	});

	it("registers page shortcuts upward and admits presses only from the kernel", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const registration = { shortcuts: ["/", "A"], type: "page-shortcuts" };
		const press = { shortcut: "A", type: "page-shortcut-press" };

		expect(Result.isSuccess(decodeClient(registration))).toBe(true);
		expect(Result.isFailure(decodeHost(registration))).toBe(true);
		expect(Result.isSuccess(decodeHost(press))).toBe(true);
		expect(Result.isFailure(decodeClient(press))).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({
					type: "page-shortcuts",
					shortcuts: Array.from({ length: MAX_PAGE_SHORTCUTS + 1 }, () => "A"),
				}),
			),
		).toBe(true);
		expect(isPageShortcut("A")).toBe(true);
		expect(isPageShortcut("/")).toBe(true);
		expect(isPageShortcut("Mod+K")).toBe(false);
		expect(isPageShortcut("a")).toBe(false);
		expect(isPageShortcut("Escape")).toBe(false);
	});

	it("defines and admits semantic kernel shortcuts only from the plugin", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const decodeShortcut = Schema.decodeUnknownResult(KernelShortcut);

		expect(KERNEL_SHORTCUTS).toEqual({
			commandCenter: "Mod+K",
			workspaceSwitcher: "Mod+Shift+Space",
		});
		for (const shortcut of ["command-center", "workspace-switcher"]) {
			const message = { shortcut, type: "kernel-shortcut" };
			expect(Result.isSuccess(decodeShortcut(shortcut))).toBe(true);
			expect(Result.isSuccess(decodeClient(message))).toBe(true);
			expect(Result.isFailure(decodeHost(message))).toBe(true);
		}
		expect(
			Result.isFailure(decodeClient({ type: "kernel-shortcut", shortcut: "command-palette" })),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({ extra: true, type: "kernel-shortcut", shortcut: "command-center" }),
			),
		).toBe(true);
	});

	it("accepts only strict leading intents and requires location ownership fields", () => {
		const decodeLeading = Schema.decodeUnknownResult(PluginLeadingIntent);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const location = { path: "/", search: "", kind: "route" };
		const message = {
			index: 0,
			location,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
		};

		for (const leading of ["back", "drawer", "none"]) {
			expect(Result.isSuccess(decodeLeading(leading))).toBe(true);
			expect(Result.isSuccess(decodeHost({ ...message, leading }))).toBe(true);
		}
		expect(Result.isFailure(decodeLeading("menu"))).toBe(true);
		expect(Result.isFailure(decodeHost({ ...message, leading: "menu" }))).toBe(true);
		const { leading: _leading, ...withoutLeading } = message;
		const { edgeBack: _edgeBack, ...withoutEdgeBack } = message;
		expect(Result.isFailure(decodeHost(withoutLeading))).toBe(true);
		expect(Result.isFailure(decodeHost(withoutEdgeBack))).toBe(true);
	});

	it("admits only strict screen-state messages stamped with an index and key", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const message = { index: 2, key: "k2", type: "screen-state", hasPreviousScreen: true };

		expect(Result.isSuccess(decode(message))).toBe(true);
		expect(Result.isFailure(decode({ ...message, index: undefined }))).toBe(true);
		expect(Result.isFailure(decode({ ...message, key: undefined }))).toBe(true);
		expect(Result.isFailure(decode({ ...message, extra: true }))).toBe(true);
	});

	it("admits lifecycle close messages in both directions", () => {
		const message = { reason: "disposed", type: "lifecycle-close" };

		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeClientMessage)(message))).toBe(
			true,
		);
		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeHostMessage)(message))).toBe(
			true,
		);
	});

	it("requires header content to identify its active screen", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeClientMessage);

		expect(
			Result.isSuccess(
				decode({ index: 2, key: "k2", type: "header", header: { title: "Details" } }),
			),
		).toBe(true);
		expect(Result.isSuccess(decode({ index: 2, key: "k2", header: null, type: "header" }))).toBe(
			true,
		);
		expect(Result.isFailure(decode({ type: "header", header: { title: "Details" } }))).toBe(true);
		expect(
			Result.isFailure(decode({ index: 2, key: "k2", type: "header", header: { title: "" } })),
		).toBe(true);
		expect(
			Result.isFailure(decode({ index: 2, key: "k2", extra: true, header: null, type: "header" })),
		).toBe(true);
	});

	it("restricts a theme snapshot to a resolved mode", () => {
		const decode = Schema.decodeUnknownResult(PluginThemeSnapshot);

		expect(Result.isSuccess(decode({ resolvedMode: "dark" }))).toBe(true);
		expect(Result.isFailure(decode({ resolvedMode: "system" }))).toBe(true);
		expect(Result.isFailure(decode({ extra: true, resolvedMode: "dark" }))).toBe(true);
	});

	it("carries the theme mode and safe-area insets on init and never on the ready echo", () => {
		const decodeInit = Schema.decodeUnknownResult(PluginBridgeInit);
		const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
		const init = {
			...identity,
			mode: "dark",
			safeAreaTop: 59,
			safeAreaBottom: 34,
			documentKey: "page-1",
		};

		expect(Result.isSuccess(decodeInit(init))).toBe(true);
		expect(Result.isFailure(decodeInit({ ...init, bridgeVersion: 2 }))).toBe(true);
		expect(
			Result.isFailure(decodeInit({ ...init, artifactHash: "hash-1", compositionHash: undefined })),
		).toBe(true);
		expect(Result.isFailure(decodeInit({ ...identity, mode: "dark" }))).toBe(true);
		expect(Result.isFailure(decodeInit({ ...init, safeAreaTop: -1 }))).toBe(true);
		expect(Result.isFailure(decodeInit({ ...init, safeAreaBottom: -1 }))).toBe(true);
		expect(Result.isSuccess(decodeReady(identity))).toBe(true);
		expect(Result.isFailure(decodeReady({ ...identity, bridgeVersion: 2 }))).toBe(true);
		expect(Result.isFailure(decodeReady(init))).toBe(true);
	});

	it("carries saved-view, plugin-route, and entity page identities", () => {
		const decode = Schema.decodeUnknownResult(ClientPageContext);
		const base = {
			view: null,
			settings: {},
			contributors: [],
			dataSources: null,
			route: { params: {} },
			renderer: { kind: "plugin", exportName: "detail", pluginId: "plugin-1" },
		};

		expect(
			Result.isSuccess(
				decode({
					...base,
					target: { kind: "saved-view", reference: { kind: "custom", savedViewId: "view-1" } },
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decode({
					...base,
					renderer: { kind: "kernel", name: "entity-browser" },
					target: { kind: "saved-view", reference: { kind: "kernel", slug: "view-1" } },
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decode({
					...base,
					route: { params: { itemId: "item-1" } },
					target: {
						path: "/items/1",
						search: "tab=stats",
						kind: "plugin-route",
						packageId: "test/plugin-1",
					},
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decode({
					...base,
					target: {
						kind: "entity",
						entityId: "entity-1",
						entitySchemaSlug: "show",
						entitySchemaPluginId: "plugin-1",
					},
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					...base,
					renderer: { kind: "custom", id: "renderer-1" },
					target: {
						kind: "entity",
						entityId: "entity-1",
						entitySchemaSlug: "system",
						entitySchemaPluginId: null,
					},
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({ ...base, target: { path: "/", search: "", kind: "plugin-route" } }),
			),
		).toBe(true);
	});

	it("admits viewport insets from the host and a drawer request from the plugin", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const viewport = { safeAreaTop: 0, type: "viewport", safeAreaBottom: 0 };

		expect(Result.isSuccess(decodeHost(viewport))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "viewport" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ safeAreaTop: 0, type: "viewport" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ ...viewport, safeAreaTop: -8 }))).toBe(true);
		expect(Result.isFailure(decodeHost({ ...viewport, safeAreaBottom: -8 }))).toBe(true);
		expect(Result.isSuccess(decodeClient({ type: "open-drawer" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "open-drawer" }))).toBe(true);
		expect(Result.isFailure(decodeClient(viewport))).toBe(true);
	});

	it("admits merged page-search push and replace updates with explicit deletions", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgePageSearch);

		expect(
			Result.isSuccess(
				decode({
					mode: "push",
					type: "page-search",
					update: { entityId: "entity-1", dialog: "add-to-collection" },
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decode({ mode: "replace", type: "page-search", update: { dialog: null, entityId: null } }),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({ mode: "replace", type: "page-search", update: { dialog: undefined } }),
			),
		).toBe(true);
	});

	it("admits only strict semantic entity picker requests from the plugin", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgePickEntityScreen);
		const request = {
			initialQuery: "Sample",
			type: "pick-entity-screen",
			requestId: "pick-entity-screen-1",
			schema: { slug: "entry", owner: { kind: "plugin", pluginId: "fixture-installation" } },
			library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
		};

		expect(Result.isSuccess(decode(request))).toBe(true);
		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeClientMessage)(request))).toBe(
			true,
		);
		expect(Result.isFailure(Schema.decodeUnknownResult(PluginBridgeHostMessage)(request))).toBe(
			true,
		);
		expect(
			Result.isFailure(decode({ ...request, schema: { slug: "entry", owner: { kind: "self" } } })),
		).toBe(true);
		const { library: _library, ...pickRequest } = request;
		expect(Result.isSuccess(decode(pickRequest))).toBe(true);
		expect(Result.isFailure(decode({ ...request, screen: "arbitrary" }))).toBe(true);
		const decodeResult = Schema.decodeUnknownResult(PluginBridgePickEntityScreenResult);
		const result = {
			outcome: "success",
			requestId: "pick-entity-screen-1",
			type: "pick-entity-screen-result",
		};
		expect(Result.isSuccess(decodeResult({ ...result, value: { kind: "create-requested" } }))).toBe(
			true,
		);
		expect(
			Result.isSuccess(
				decodeResult({ ...result, value: { kind: "selected", entityIds: ["entity-1"] } }),
			),
		).toBe(true);
		expect(Result.isFailure(decodeResult({ ...result, value: { kind: "created" } }))).toBe(true);
		const refresh = { type: "page-refresh" };
		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgePageRefresh)(refresh))).toBe(
			true,
		);
		expect(Result.isSuccess(Schema.decodeUnknownResult(PluginBridgeHostMessage)(refresh))).toBe(
			true,
		);
		expect(Result.isFailure(Schema.decodeUnknownResult(PluginBridgeClientMessage)(refresh))).toBe(
			true,
		);
	});

	it("uses tagged logical locations by bridge direction", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const decodeTarget = Schema.decodeUnknownResult(PluginNavigationTarget);
		const hostFields = {
			index: 0,
			key: "k0",
			compact: false,
			leading: "none",
			edgeBack: false,
			type: "location",
		};
		const targetEntity = { kind: "entity", entityId: "entity-1" };
		const route = { kind: "route", path: "/details", search: "tab=stats" };
		const pluginRoute = {
			path: "/details",
			search: "tab=stats",
			kind: "plugin-route",
			packageId: "test/fixture",
		};
		const savedView = {
			kind: "saved-view",
			reference: { kind: "plugin", slug: "view-1", pluginId: "plugin-1" },
		};
		const entity = {
			kind: "entity",
			entityId: "entity-1",
			entitySchemaSlug: "show",
			search: "dialog=details",
		};

		expect(Result.isSuccess(decodeHost({ ...hostFields, location: route }))).toBe(true);
		expect(Result.isSuccess(decodeHost({ ...hostFields, location: entity }))).toBe(true);
		const { search: _entitySearch, ...entityWithoutSearch } = entity;
		expect(Result.isFailure(decodeHost({ ...hostFields, location: entityWithoutSearch }))).toBe(
			true,
		);
		expect(Result.isSuccess(decodeTarget(pluginRoute))).toBe(true);
		expect(Result.isSuccess(decodeTarget(savedView))).toBe(true);
		expect(Result.isSuccess(decodeTarget(targetEntity))).toBe(true);
		expect(Result.isSuccess(decodeTarget({ kind: "kernel-page", page: "import-data" }))).toBe(true);
		expect(
			Result.isSuccess(decodeTarget({ kind: "kernel-page", page: "plugin-preferences" })),
		).toBe(true);
		expect(Result.isFailure(decodeTarget({ page: "settings", kind: "kernel-page" }))).toBe(true);
		expect(
			Result.isFailure(
				decodeTarget({ path: "/settings", kind: "kernel-page", page: "import-data" }),
			),
		).toBe(true);
		expect(Result.isFailure(decodeTarget(route))).toBe(true);
		expect(Result.isFailure(decodeTarget({ path: route.path, search: route.search }))).toBe(true);
		expect(Result.isFailure(decodeTarget({ ...pluginRoute, extra: true }))).toBe(true);
		expect(Result.isFailure(decodeTarget({ ...pluginRoute, packageId: undefined }))).toBe(true);
		expect(Result.isFailure(decodeTarget({ ...targetEntity, entitySchemaSlug: "show" }))).toBe(
			true,
		);
		expect(
			Result.isFailure(
				decodeHost({ ...hostFields, location: { path: route.path, search: route.search } }),
			),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...hostFields, location: { ...route, kind: "unknown" } })),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...hostFields, location: { ...route, extra: true } })),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...hostFields, location: { ...entity, extra: true } })),
		).toBe(true);
		expect(
			Result.isSuccess(decodeClient({ mode: "push", type: "navigate", target: pluginRoute })),
		).toBe(true);
		expect(
			Result.isSuccess(decodeClient({ mode: "replace", type: "navigate", target: savedView })),
		).toBe(true);
		expect(
			Result.isSuccess(decodeClient({ mode: "push", type: "navigate", target: targetEntity })),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({ mode: "push", leading: "back", type: "navigate", target: pluginRoute }),
			),
		).toBe(true);
		expect(
			Result.isFailure(decodeClient({ mode: "push", type: "navigate", location: pluginRoute })),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({
					mode: "push",
					type: "navigate",
					target: { path: route.path, search: route.search },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({
					mode: "push",
					type: "navigate",
					target: { ...targetEntity, entitySchemaSlug: "show" },
				}),
			),
		).toBe(true);
	});

	it("admits a theme mode event and no applied acknowledgement", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);

		expect(Result.isSuccess(decodeHost({ mode: "light", type: "theme" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "theme" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ type: "theme", mode: "system" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ type: "theme-applied" }))).toBe(true);
	});

	it("decodes a strict RyotQL request", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeClientMessage);

		expect(
			Result.isSuccess(decode({ document, requestId: "request-1", type: "ryotql-request" })),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({ document, userId: "user-1", requestId: "request-1", type: "ryotql-request" }),
			),
		).toBe(true);
	});

	it("decodes strict entity editor saves and typed results", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const request = {
			requestId: "save-1",
			idempotencyKey: "form-1",
			submittedAt: "2026-10-19T00:00:00.000Z",
			type: "entity-editor-save-request" as const,
			submission: {
				name: "Item",
				properties: {},
				relationships: [],
				target: { kind: "create" },
				entitySchema: { slug: "item", owner: { kind: "plugin", pluginId: "plugin-1" } },
			},
		};

		expect(Result.isSuccess(decodeClient(request))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, userId: "user-controlled" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, submittedAt: "yesterday" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, idempotencyKey: "" }))).toBe(true);
		const result = { requestId: "save-1", type: "entity-editor-save-result" };
		expect(
			Result.isSuccess(
				decodeHost({ ...result, outcome: "success", output: { kind: "saved", entityId: "e-1" } }),
			),
		).toBe(true);
		expect(
			Result.isSuccess(decodeHost({ ...result, outcome: "failure", reason: "invalid-request" })),
		).toBe(true);
		expect(
			Result.isFailure(decodeHost({ ...result, outcome: "failure", reason: "query-failed" })),
		).toBe(true);
	});

	it("admits only ID-carrying collection host screen requests from the plugin", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const decodeEdit = Schema.decodeUnknownResult(PluginBridgeEditCollectionScreen);
		const decodeAdd = Schema.decodeUnknownResult(PluginBridgeAddToCollectionScreen);
		const edit = {
			collectionId: "collection-1",
			type: "edit-collection-screen",
			requestId: "edit-collection-screen-1",
		};
		const add = {
			entityId: "entity-1",
			collectionId: "collection-1",
			type: "add-to-collection-screen",
			requestId: "add-to-collection-screen-1",
		};

		for (const request of [edit, add]) {
			expect(Result.isSuccess(decodeClient(request))).toBe(true);
			expect(Result.isFailure(decodeHost(request))).toBe(true);
		}
		const { collectionId: _editCollectionId, ...create } = edit;
		const { collectionId: _addCollectionId, ...pick } = add;
		expect(Result.isSuccess(decodeEdit(create))).toBe(true);
		expect(Result.isSuccess(decodeAdd(pick))).toBe(true);
		expect(Result.isFailure(decodeAdd({ ...pick, entityId: undefined }))).toBe(true);
		for (const extra of [
			{ name: "Favorites" },
			{ description: "Saved" },
			{ fields: [] },
			{ properties: { note: "x" } },
			{ action: "delete" },
			{ delete: true },
		]) {
			expect(Result.isFailure(decodeEdit({ ...edit, ...extra }))).toBe(true);
			expect(Result.isFailure(decodeAdd({ ...add, ...extra }))).toBe(true);
			expect(Result.isFailure(decodeClient({ ...edit, ...extra }))).toBe(true);
			expect(Result.isFailure(decodeClient({ ...add, ...extra }))).toBe(true);
		}
		const cancel = { requestId: "screen-1", type: "edit-collection-screen-cancel" };
		expect(Result.isSuccess(decodeClient(cancel))).toBe(true);
		expect(
			Result.isSuccess(decodeClient({ ...cancel, type: "add-to-collection-screen-cancel" })),
		).toBe(true);
		expect(Result.isFailure(decodeClient({ ...cancel, collectionId: "collection-1" }))).toBe(true);
	});

	it("returns only minimal collection host screen outcomes", () => {
		const decodeEdit = Schema.decodeUnknownResult(PluginBridgeEditCollectionScreenResult);
		const decodeAdd = Schema.decodeUnknownResult(PluginBridgeAddToCollectionScreenResult);
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const edit = {
			outcome: "success",
			requestId: "edit-collection-screen-1",
			type: "edit-collection-screen-result",
		};
		const add = {
			outcome: "success",
			requestId: "add-to-collection-screen-1",
			type: "add-to-collection-screen-result",
		};

		for (const value of [
			{ kind: "saved", collectionId: "collection-1" },
			{ kind: "deleted" },
			{ kind: "cancelled" },
		]) {
			expect(Result.isSuccess(decodeEdit({ ...edit, value }))).toBe(true);
			expect(Result.isFailure(decodeClient({ ...edit, value }))).toBe(true);
		}
		for (const value of [
			{ kind: "saved" },
			{ kind: "removed" },
			{ kind: "saved", name: "Favorites", collectionId: "collection-1" },
			{ kind: "deleted", collectionId: "collection-1" },
			{ reason: "closed", kind: "cancelled" },
		]) {
			expect(Result.isFailure(decodeEdit({ ...edit, value }))).toBe(true);
		}
		for (const value of [{ kind: "saved" }, { kind: "removed" }, { kind: "cancelled" }]) {
			expect(Result.isSuccess(decodeAdd({ ...add, value }))).toBe(true);
		}
		for (const value of [
			{ kind: "saved", collectionId: "collection-1" },
			{ kind: "saved", properties: {} },
			{ kind: "removed", entityId: "entity-1" },
			{ kind: "deleted" },
		]) {
			expect(Result.isFailure(decodeAdd({ ...add, value }))).toBe(true);
		}
		const { value: _value, ...failure } = { ...edit, value: null };
		expect(
			Result.isSuccess(decodeEdit({ ...failure, outcome: "failure", reason: "transport" })),
		).toBe(true);
		expect(
			Result.isFailure(decodeEdit({ ...failure, outcome: "failure", reason: "name-taken" })),
		).toBe(true);
	});

	it("keeps the collection capability to create and membership actions", () => {
		const decode = Schema.decodeUnknownResult(PluginCollectionRequest);
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const allowed = [
			{ action: "create", input: { name: "Favorites" } },
			{ action: "upsert-membership", input: { collectionId: "c-1", entityId: "entity-1" } },
			{ action: "remove-membership", input: { collectionId: "c-1", entityId: "entity-1" } },
		];
		const rejected = [
			{ action: "update", input: { fields: [], name: "Renamed", collectionId: "c-1" } },
			{ action: "update", input: { name: "Renamed", description: null, collectionId: "c-1" } },
			{ action: "delete", input: { collectionId: "c-1" } },
			{ action: "delete-collection", input: { collectionId: "c-1" } },
		];

		for (const request of allowed) {
			expect(Result.isSuccess(decode(request))).toBe(true);
			expect(
				Result.isSuccess(
					decodeClient({ ...request, requestId: "collection-1", type: "collection-request" }),
				),
			).toBe(true);
		}
		for (const request of rejected) {
			expect(Result.isFailure(decode(request))).toBe(true);
			expect(
				Result.isFailure(
					decodeClient({ ...request, requestId: "collection-1", type: "collection-request" }),
				),
			).toBe(true);
		}
	});

	it("decodes strict collection mutations and typed results", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeResult = Schema.decodeUnknownResult(PluginBridgeCollectionResult);
		const request = {
			requestId: "collection-1",
			type: "collection-request" as const,
			action: "upsert-membership" as const,
			input: { entityId: "entity-1", properties: { rank: 1 }, collectionId: "collection-1" },
		};

		expect(Result.isSuccess(decodeClient(request))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, userId: "user-controlled" }))).toBe(true);
		expect(
			Result.isFailure(decodeClient({ ...request, input: { collectionId: "collection-1" } })),
		).toBe(true);
		expect(
			Result.isSuccess(
				decodeResult({
					outcome: "success",
					type: "collection-result",
					requestId: "collection-1",
					response: {
						warnings: [],
						memberOf: {
							properties: {},
							id: "relationship-1",
							sourceEntityId: "entity-1",
							targetEntityId: "collection-1",
							relationshipSchemaPluginId: null,
							relationshipSchemaSlug: "member-of",
							createdAt: "2026-09-07T00:00:00.000Z",
						},
					},
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeResult({
					outcome: "success",
					type: "collection-result",
					requestId: "collection-1",
					response: { memberOf: { id: "relationship-1" } },
				}),
			),
		).toBe(true);
	});

	it("decodes strict calendar source visibility requests and results", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const request = {
			isHidden: true,
			slug: "reminders",
			pluginId: "plugin-1",
			requestId: "calendar-1",
			type: "calendar-source-visibility-request" as const,
		};
		const result = { requestId: "calendar-1", type: "calendar-source-visibility-result" as const };

		expect(Result.isSuccess(decodeClient(request))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, userId: "user-controlled" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, isHidden: "yes" }))).toBe(true);
		expect(Result.isSuccess(decodeHost({ ...result, outcome: "success" }))).toBe(true);
		expect(
			Result.isSuccess(decodeHost({ ...result, outcome: "failure", reason: "invalid-request" })),
		).toBe(true);
		expect(Result.isFailure(decodeHost({ ...result, reason: "quota", outcome: "failure" }))).toBe(
			true,
		);
	});

	it("bounds storage keys and carries a value only on set", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const request = {
			pluginId: "fixture",
			key: "subpart-order",
			requestId: "storage-1",
			type: "storage-request" as const,
		};

		expect(Result.isSuccess(decodeClient({ ...request, action: "get" }))).toBe(true);
		expect(Result.isSuccess(decodeClient({ ...request, action: "set", value: { a: [1] } }))).toBe(
			true,
		);
		expect(Result.isFailure(decodeClient({ ...request, action: "set" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, value: 1, action: "get" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, value: 1, action: "remove" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, key: "", action: "get" }))).toBe(true);
		expect(
			Result.isSuccess(
				decodeClient({ ...request, action: "get", key: "k".repeat(PLUGIN_STORAGE_KEY_MAX_LENGTH) }),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({
					...request,
					action: "get",
					key: "k".repeat(PLUGIN_STORAGE_KEY_MAX_LENGTH + 1),
				}),
			),
		).toBe(true);
		expect(Result.isFailure(decodeHost({ ...request, action: "get" }))).toBe(true);

		const result = { requestId: "storage-1", type: "storage-result" as const };
		const decodeResult = Schema.decodeUnknownResult(PluginBridgeStorageResult);
		expect(Result.isSuccess(decodeResult({ ...result, value: null, outcome: "success" }))).toBe(
			true,
		);
		expect(Result.isSuccess(decodeResult({ ...result, reason: "quota", outcome: "failure" }))).toBe(
			true,
		);
		expect(
			Result.isFailure(decodeResult({ ...result, outcome: "failure", reason: "operation-failed" })),
		).toBe(true);
		expect(Result.isFailure(decodeClient({ ...result, value: null, outcome: "success" }))).toBe(
			true,
		);
	});

	it("names only a plugin in user settings requests and returns a settings record", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const request = {
			pluginId: "fixture",
			requestId: "settings-1",
			type: "user-settings-request" as const,
		};
		expect(Result.isSuccess(decodeClient(request))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, installationId: "other" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, userId: "other" }))).toBe(true);
		expect(Result.isFailure(decodeHost(request))).toBe(true);

		const result = { requestId: "settings-1", type: "user-settings-result" as const };
		expect(
			Result.isSuccess(decodeHost({ ...result, outcome: "success", settings: { limit: 3 } })),
		).toBe(true);
		expect(
			Result.isSuccess(decodeHost({ ...result, outcome: "failure", reason: "invalid-request" })),
		).toBe(true);
		expect(Result.isFailure(decodeHost({ ...result, outcome: "success" }))).toBe(true);
		expect(Result.isFailure(decodeHost({ ...result, reason: "quota", outcome: "failure" }))).toBe(
			true,
		);
	});

	it("names a plugin and entity in population retry requests and returns a retried flag", () => {
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);
		const request = {
			pluginId: "fixture",
			entityId: "entity-1",
			requestId: "retry-1",
			type: "retry-population-request" as const,
		};
		expect(Result.isSuccess(decodeClient(request))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, userId: "other" }))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, pluginId: undefined }))).toBe(true);
		expect(Result.isFailure(decodeHost(request))).toBe(true);

		const result = { requestId: "retry-1", type: "retry-population-result" as const };
		expect(Result.isSuccess(decodeHost({ ...result, retried: true, outcome: "success" }))).toBe(
			true,
		);
		expect(
			Result.isSuccess(decodeHost({ ...result, outcome: "failure", reason: "invalid-request" })),
		).toBe(true);
		expect(Result.isFailure(decodeHost({ ...result, outcome: "success" }))).toBe(true);
		expect(
			Result.isFailure(
				decodeHost({ ...result, outcome: "failure", reason: "provider-unavailable" }),
			),
		).toBe(true);
	});

	it("decodes only the strict RyotQL cancellation message", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeRyotQLCancel);

		expect(Result.isSuccess(decode({ type: "ryotql-cancel", requestId: "request-1" }))).toBe(true);
		expect(
			Result.isFailure(decode({ reason: "caller", type: "ryotql-cancel", requestId: "request-1" })),
		).toBe(true);
		expect(Result.isFailure(decode({ type: "ryotql-cancel" }))).toBe(true);
	});

	it("carries an upload source as a Blob and rejects any other value", () => {
		const decodeRequest = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const request = {
			fileName: "items.csv",
			requestId: "request-1",
			contentType: "text/csv",
			action: "temporary" as const,
			type: "upload-request" as const,
			source: new Blob(["id,title"], { type: "text/csv" }),
		};

		const decoded = decodeRequest(request);
		expect(Result.isSuccess(decoded)).toBe(true);
		expect(Result.isSuccess(decoded) && decoded.success).toMatchObject({ source: request.source });

		expect(Result.isFailure(decodeRequest({ ...request, source: {} }))).toBe(true);
		expect(Result.isFailure(decodeRequest({ ...request, source: "id,title" }))).toBe(true);
		expect(Result.isFailure(decodeRequest({ ...request, source: new Uint8Array([1, 2, 3]) }))).toBe(
			true,
		);
	});

	it("accepts a File as an upload source because File extends Blob", () => {
		const decodeRequest = Schema.decodeUnknownResult(PluginBridgeClientMessage);

		expect(
			Result.isSuccess(
				decodeRequest({
					action: "temporary",
					fileName: "items.csv",
					requestId: "request-1",
					type: "upload-request",
					contentType: "text/csv",
					source: new File(["id,title"], "items.csv", { type: "text/csv" }),
				}),
			),
		).toBe(true);
	});

	it("reports discriminated upload outcomes or a bridge reason", () => {
		const decodeResult = Schema.decodeUnknownResult(PluginBridgeUploadResult);

		expect(
			Result.isSuccess(
				decodeResult({
					outcome: "success",
					action: "temporary",
					type: "upload-result",
					requestId: "request-1",
					token: { token: "upload-token", expiresAt: "2026-01-01T00:00:00.000Z" },
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decodeResult({
					outcome: "failure",
					type: "upload-result",
					requestId: "request-1",
					reason: "operation-failed",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeResult({
					outcome: "failure",
					type: "upload-result",
					requestId: "request-1",
					reason: "asset-failed",
				}),
			),
		).toBe(true);
	});

	it("requires JSON operation inputs and success values", () => {
		const decodeRequest = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const decodeResult = Schema.decodeUnknownResult(PluginBridgeOperationResult);

		expect(
			Result.isSuccess(
				decodeRequest({
					requestId: "request-1",
					operationSlug: "greet",
					packageId: "test/fixture",
					type: "operation-request",
					input: { values: [null, true, 1, "ok"] },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeRequest({
					input: null,
					requestId: "request-1",
					operationSlug: "greet",
					packageId: "test/fixture",
					type: "operation-request",
					contentHash: "plugin-controlled-source-hash",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeRequest({
					requestId: "request-1",
					operationSlug: "greet",
					packageId: "test/fixture",
					type: "operation-request",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeRequest({
					requestId: "request-1",
					operationSlug: "greet",
					packageId: "test/fixture",
					type: "operation-request",
					input: { invalid: undefined },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeRequest({
					input: null,
					requestId: "request-1",
					operationSlug: "greet",
					type: "operation-request",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeResult({
					outcome: "success",
					value: () => undefined,
					requestId: "request-1",
					type: "operation-result",
				}),
			),
		).toBe(true);
	});

	it("defines independent public client errors and strict wire subsets", () => {
		const decodeOperationBridge = Schema.decodeUnknownResult(PluginOperationBridgeErrorReason);
		const decodeQueryBridge = Schema.decodeUnknownResult(PluginRyotQLFailureReason);
		const decodeAssetBridge = Schema.decodeUnknownResult(PluginAssetBridgeErrorReason);
		const decodePublic = Schema.decodeUnknownResult(RyotClientErrorReason);
		const operationBridgeReasons = [
			"transport",
			"operation-failed",
			"operation-rejected",
			"malformed-result",
		];
		const queryBridgeReasons = ["transport", "query-failed"];
		const assetBridgeReasons = ["transport", "asset-failed", "malformed-result"];
		const publicReasons = [
			"disposed",
			"protocol",
			"transport",
			"invalid-input",
			"asset-failed",
			"collection-failed",
			"entity-save-failed",
			"query-failed",
			"operation-failed",
			"operation-rejected",
			"malformed-result",
			"unsupported-capability",
			"invalid-request",
			"quota",
		];

		for (const reason of publicReasons) {
			expect(Result.isSuccess(decodePublic(reason))).toBe(true);
		}
		for (const reason of operationBridgeReasons) {
			expect(Result.isSuccess(decodeOperationBridge(reason))).toBe(true);
		}
		for (const reason of queryBridgeReasons) {
			expect(Result.isSuccess(decodeQueryBridge(reason))).toBe(true);
		}
		for (const reason of assetBridgeReasons) {
			expect(Result.isSuccess(decodeAssetBridge(reason))).toBe(true);
		}
		expect(Result.isFailure(decodeOperationBridge("query-failed"))).toBe(true);
		expect(Result.isFailure(decodeQueryBridge("operation-failed"))).toBe(true);
		expect(Result.isFailure(decodeAssetBridge("query-failed"))).toBe(true);
		expect(Result.isFailure(decodePublic("failure"))).toBe(true);
	});

	it("decodes strict managed asset requests and cancellation messages", () => {
		const decodeRequest = Schema.decodeUnknownResult(PluginAssetRequest);
		const decodeBridgeRequest = Schema.decodeUnknownResult(PluginBridgeAssetRequest);
		const decodeCancel = Schema.decodeUnknownResult(PluginBridgeAssetCancel);
		const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
		const asset = { type: "local", key: "permanent/image.png" };

		expect(Result.isSuccess(decodeRequest({ assets: [asset] }))).toBe(true);
		expect(Result.isFailure(decodeRequest({ assets: [] }))).toBe(true);
		expect(
			Result.isFailure(decodeRequest({ assets: [{ type: "remote", url: "https://example.com" }] })),
		).toBe(true);
		expect(Result.isFailure(decodeRequest({ extra: true, assets: [asset] }))).toBe(true);
		expect(
			Result.isSuccess(
				decodeBridgeRequest({ assets: [asset], requestId: "asset-1", type: "asset-request" }),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decodeClient({ assets: [asset], requestId: "asset-1", type: "asset-request" }),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeBridgeRequest({
					extra: true,
					assets: [asset],
					requestId: "asset-1",
					type: "asset-request",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeBridgeRequest({ assets: [], requestId: "asset-1", type: "asset-request" }),
			),
		).toBe(true);
		expect(Result.isSuccess(decodeCancel({ requestId: "asset-1", type: "asset-cancel" }))).toBe(
			true,
		);
		expect(Result.isSuccess(decodeClient({ requestId: "asset-1", type: "asset-cancel" }))).toBe(
			true,
		);
		expect(
			Result.isFailure(decodeCancel({ extra: true, requestId: "asset-1", type: "asset-cancel" })),
		).toBe(true);
	});

	it("decodes strict managed asset resolutions, outcomes, and bridge results", () => {
		const decodeResolution = Schema.decodeUnknownResult(PluginManagedAssetResolution);
		const decodeOutcome = Schema.decodeUnknownResult(PluginAssetOutcome);
		const decodeResult = Schema.decodeUnknownResult(PluginBridgeAssetResult);
		const resolution = {
			expiresAt: "2026-01-01T00:15:00.000Z",
			asset: { type: "local", key: "permanent/image.png" },
			url: "https://ryot.test/api/uploads/local/download?key=permanent%2Fimage.png",
		};

		expect(Result.isSuccess(decodeResolution(resolution))).toBe(true);
		expect(Result.isFailure(decodeResolution({ ...resolution, extra: true }))).toBe(true);
		expect(Result.isFailure(decodeResolution({ ...resolution, expiresAt: "tomorrow" }))).toBe(true);
		expect(Result.isFailure(decodeResolution({ ...resolution, url: "/uploads/image.png" }))).toBe(
			true,
		);
		expect(Result.isSuccess(decodeOutcome({ outcome: "success", resolutions: [resolution] }))).toBe(
			true,
		);
		expect(Result.isSuccess(decodeOutcome({ outcome: "failure", reason: "asset-failed" }))).toBe(
			true,
		);
		expect(
			Result.isSuccess(
				decodeResult({
					outcome: "success",
					requestId: "asset-1",
					type: "asset-result",
					resolutions: [resolution],
				}),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decodeResult({
					outcome: "failure",
					requestId: "asset-1",
					type: "asset-result",
					reason: "asset-failed",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeResult({
					extra: true,
					outcome: "failure",
					requestId: "asset-1",
					type: "asset-result",
					reason: "asset-failed",
				}),
			),
		).toBe(true);
	});

	it("accepts only bridge operation errors on strict result messages", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeOperationResult);

		for (const reason of ["transport", "operation-failed", "malformed-result"]) {
			expect(
				Result.isSuccess(
					decode({ reason, outcome: "failure", requestId: "request-1", type: "operation-result" }),
				),
			).toBe(true);
		}
		const rejected = {
			outcome: "failure",
			requestId: "request-1",
			type: "operation-result",
			reason: "operation-rejected",
		};
		expect(Result.isSuccess(decode({ ...rejected, message: "Not allowed" }))).toBe(true);
		expect(Result.isFailure(decode(rejected))).toBe(true);
		expect(
			Result.isFailure(
				decode({
					reason: "protocol",
					outcome: "failure",
					requestId: "request-1",
					type: "operation-result",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					debug: true,
					outcome: "failure",
					reason: "transport",
					requestId: "request-1",
					type: "operation-result",
				}),
			),
		).toBe(true);
	});

	it("decodes only strict RyotQL success and failure results", () => {
		const decode = Schema.decodeUnknownResult(PluginBridgeRyotQLResult);
		const response = {
			data: {
				items: {
					items: [],
					type: "rows",
					pageInfo: { limit: 10, hasMore: false, nextCursor: null },
				},
			},
		};

		expect(
			Result.isSuccess(
				decode({ response, outcome: "success", type: "ryotql-result", requestId: "request-1" }),
			),
		).toBe(true);
		expect(
			Result.isSuccess(
				decode({
					outcome: "failure",
					type: "ryotql-result",
					reason: "query-failed",
					requestId: "request-1",
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decode({
					cause: "secret",
					outcome: "failure",
					reason: "transport",
					type: "ryotql-result",
					requestId: "request-1",
				}),
			),
		).toBe(true);
	});
});
