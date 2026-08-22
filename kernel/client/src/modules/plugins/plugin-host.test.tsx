// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	CLIENT_API_VERSION,
	PluginBridgeInit,
	PluginEntityLocation,
	type PluginAssetOutcome,
	type PluginLeadingIntent,
	type PluginThemeSnapshot,
	type PluginLogicalLocation,
	type PluginRouteLocation,
	type PluginOperationOutcome,
	type PluginRyotQLOutcome,
} from "@ryot-app/client-plugin-contract";
import type { PluginClientCatalogEntry } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Schema } from "effect";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginScreenReadiness } from "#/modules/plugins/bridge";
import {
	PluginHost,
	type CreatePluginArtifactSession,
	type PluginArtifactSession,
	type PluginHeaderPublication,
	type RenewPluginArtifactSession,
	type RevokePluginArtifactSession,
} from "#/modules/plugins/plugin-host";
import type { PluginNavigationRequest } from "#/modules/plugins/plugin-location";
import type { ThemeStore } from "#/modules/theme/store";

const home: PluginRouteLocation = { kind: "route", path: "/", search: "" };
const entity = Schema.decodeUnknownSync(PluginEntityLocation)({
	entityId: "entity-1",
	entitySchemaSlug: "show",
	kind: "entity",
});
const navigationFor = (state: {
	readonly index?: number;
	readonly compact?: boolean;
	readonly edgeBack?: boolean;
	readonly leading?: PluginLeadingIntent;
	readonly location: PluginLogicalLocation;
}) => ({
	compact: state.compact ?? false,
	edgeBack: state.edgeBack ?? false,
	index: state.index ?? 0,
	leading: state.leading ?? "none",
	location: state.location,
	key: `k${state.index ?? 0}`,
});
const themeSnapshot: PluginThemeSnapshot = { resolvedMode: "light" };

const installation = {
	sortOrder: 0,
	icon: "puzzle",
	name: "Fixture",
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} satisfies PluginClientCatalogEntry;

type HostState = {
	readonly index?: number;
	readonly compact?: boolean;
	readonly scopeKey?: string;
	readonly edgeBack?: boolean;
	readonly leading?: PluginLeadingIntent;
	readonly location: PluginLogicalLocation;
	readonly overrides: Partial<PluginClientCatalogEntry>;
};

type CreateCall = {
	readonly signal: AbortSignal;
	readonly request: Parameters<CreatePluginArtifactSession>[0];
};

function deferred<T>() {
	let reject!: (reason?: unknown) => void;
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res, rej) => {
		reject = rej;
		resolve = res;
	});
	return { promise, reject, resolve };
}

function createTheme(): ThemeStore {
	const listeners = new Set<() => void>();
	return {
		destroy: () => undefined,
		getPreference: () => "light",
		setPreference: () => undefined,
		getSnapshot: () => themeSnapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const at = (milliseconds: number) => new Date(Date.now() + milliseconds).toISOString();
const artifactSession = (sessionId: string, expiresAt = at(10 * 60_000)) => ({
	expiresAt,
	sessionId,
	src: `https://artifacts.example/${sessionId}/index.html?token=secret-${sessionId}`,
});

function createRecorder(
	options: {
		readonly renew?: RenewPluginArtifactSession;
		readonly create?: CreatePluginArtifactSession;
		readonly revoke?: RevokePluginArtifactSession;
	} = {},
) {
	let nextSession = 0;
	const events: string[] = [];
	const revokes: string[] = [];
	const creates: CreateCall[] = [];
	const renews: Array<{ readonly signal: AbortSignal; readonly sessionId: string }> = [];
	const onCreateArtifactSession: CreatePluginArtifactSession = (request, signal) => {
		creates.push({ request, signal });
		events.push(`create:${request.artifactHash}`);
		if (options.create !== undefined) {
			return options.create(request, signal);
		}
		nextSession += 1;
		return Promise.resolve(artifactSession(`session-${nextSession}`));
	};
	const onRenewArtifactSession: RenewPluginArtifactSession = (sessionId, signal) => {
		renews.push({ sessionId, signal });
		events.push(`renew:${sessionId}`);
		return (
			options.renew?.(sessionId, signal) ??
			Promise.resolve({ expiresAt: at(10 * 60_000), outcome: "renewed" })
		);
	};
	const onRevokeArtifactSession: RevokePluginArtifactSession = (sessionId) => {
		revokes.push(sessionId);
		events.push(`revoke:${sessionId}`);
		return options.revoke?.(sessionId) ?? Promise.resolve();
	};
	return {
		events,
		renews,
		revokes,
		creates,
		onRenewArtifactSession,
		onCreateArtifactSession,
		onRevokeArtifactSession,
	};
}

function renderHost(
	recorder = createRecorder(),
	overrides: Partial<PluginClientCatalogEntry> = {},
	location = home,
	callbacks: {
		readonly onStaleSession?: () => void;
		readonly onQuery?: Parameters<typeof PluginHost>[0]["onQuery"];
		readonly onAssets?: Parameters<typeof PluginHost>[0]["onAssets"];
		readonly onHeader?: Parameters<typeof PluginHost>[0]["onHeader"];
		readonly onScreenState?: Parameters<typeof PluginHost>[0]["onScreenState"];
		readonly onKernelShortcut?: Parameters<typeof PluginHost>[0]["onKernelShortcut"];
		readonly onInvokeOperation?: Parameters<typeof PluginHost>[0]["onInvokeOperation"];
	} = {},
) {
	const backs: null[] = [];
	const drawers: null[] = [];
	const chromeTrigger = { current: null };
	const theme = createTheme();
	const navigations: PluginNavigationRequest[] = [];
	const screenStates: Array<PluginScreenReadiness | null> = [];
	const host = (state: HostState) => (
		<PluginHost
			theme={theme}
			chromeLeading={null}
			viewport={{ safeAreaTop: 0, safeAreaBottom: 0 }}
			chromeTriggerRef={chromeTrigger}
			navigation={navigationFor(state)}
			onOpenDrawer={() => drawers.push(null)}
			onNavigateBack={() => backs.push(null)}
			onHeader={callbacks.onHeader ?? (() => undefined)}
			installation={{ ...installation, ...state.overrides }}
			onRenewArtifactSession={recorder.onRenewArtifactSession}
			artifactSessionScopeKey={state.scopeKey ?? "server:user"}
			onCreateArtifactSession={recorder.onCreateArtifactSession}
			onRevokeArtifactSession={recorder.onRevokeArtifactSession}
			onNavigate={(request) => navigations.push(request)}
			onStaleSession={callbacks.onStaleSession ?? (() => undefined)}
			onKernelShortcut={callbacks.onKernelShortcut ?? (() => undefined)}
			onAssets={
				callbacks.onAssets ?? (() => Promise.resolve({ outcome: "failure", reason: "transport" }))
			}
			onScreenState={(screenState) => {
				screenStates.push(screenState);
				callbacks.onScreenState?.(screenState);
			}}
			onQuery={
				callbacks.onQuery ??
				(() => Promise.resolve({ outcome: "failure", reason: "transport" } as PluginRyotQLOutcome))
			}
			onInvokeOperation={
				callbacks.onInvokeOperation ??
				(() =>
					Promise.resolve({ outcome: "failure", reason: "transport" } as PluginOperationOutcome))
			}
		/>
	);
	const view = render(host({ location, overrides }));
	return {
		...recorder,
		navigations,
		screenStates,
		unmount: view.unmount,
		moveTo: (next: HostState) => view.rerender(host(next)),
	};
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

function connectFrame(frame: HTMLIFrameElement) {
	const messages: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let pluginPort: MessagePort | undefined;
	Object.defineProperty(frame, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (message: unknown, _origin: string, transfer: Transferable[]) => {
				const [transferred] = transfer;
				if (!(transferred instanceof MessagePort)) {
					throw new Error("Missing plugin port");
				}
				init = Schema.decodeUnknownSync(PluginBridgeInit)(message);
				pluginPort = transferred;
				transferred.addEventListener("message", (event) => messages.push(event.data));
				transferred.start();
			},
		},
	});
	fireEvent.load(frame);
	if (init === undefined || pluginPort === undefined) {
		throw new Error("Plugin bridge did not connect");
	}
	const {
		mode: _mode,
		safeAreaTop: _safeAreaTop,
		safeAreaBottom: _safeAreaBottom,
		...ready
	} = init;
	return { init, ready, messages, pluginPort };
}

afterEach(() => vi.useRealTimers());

describe("plugin artifact session lifecycle", () => {
	it("creates before rendering the isolated iframe and keeps credentials out of bridge metadata", async () => {
		const pending = deferred<PluginArtifactSession>();
		const recorder = createRecorder({ create: () => pending.promise });
		renderHost(recorder);

		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe("Preparing this plugin...");
		expect(recorder.creates).toHaveLength(1);
		expect(recorder.creates[0]?.request).toEqual({
			sourceHash: "source-hash",
			artifactHash: "artifact-hash",
			installationId: "installation-1",
		});

		pending.resolve(artifactSession("artifact-session"));
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(frame.getAttribute("src")).toContain("token=secret-artifact-session");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");

		const connected = connectFrame(frame);
		expect(connected.init.artifactHash).toBe("artifact-hash");
		expect(JSON.stringify(connected.init)).not.toContain("artifact-session");
		expect(JSON.stringify(connected.init)).not.toContain("secret");
	});

	it.each([
		{ health: "installing", clientArtifactHash: null },
		{ health: "failed" },
		{ health: "incompatible" },
		{ clientArtifactHash: null },
		{ clientApiVersion: null },
		{ clientApiVersion: CLIENT_API_VERSION + 1 },
	] satisfies Array<Partial<PluginClientCatalogEntry>>)(
		"does not create a session for blocked catalog state %#",
		(overrides) => {
			const recorder = createRecorder();
			renderHost(recorder, overrides);
			expect(recorder.creates).toEqual([]);
			expect(screen.queryByTitle("fixture plugin")).toBeNull();
		},
	);

	it("replaces and revokes when the server or user scope changes", async () => {
		const host = renderHost();
		await flush();

		host.moveTo({ scopeKey: "other-server:user", location: home, overrides: {} });
		await flush();

		expect(host.creates).toHaveLength(2);
		expect(host.revokes).toEqual(["session-1"]);
	});

	it("forwards current screen readiness and sends only location for navigation chrome changes", async () => {
		const host = renderHost();
		await flush();
		const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		const connected = connectFrame(frame);
		connected.pluginPort.postMessage(connected.ready);
		await flush();
		host.screenStates.splice(0);
		connected.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "screen-state",
			hasPreviousScreen: false,
		});
		await flush();

		host.moveTo({
			index: 1,
			compact: true,
			overrides: {},
			edgeBack: true,
			leading: "back",
			location: { kind: "route", path: "/items/one", search: "tab=stats" },
		});
		await flush();
		connected.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "screen-state",
			hasPreviousScreen: true,
		});
		connected.pluginPort.postMessage({
			index: 1,
			key: "k1",
			type: "screen-state",
			hasPreviousScreen: true,
		});
		await flush();

		expect(host.creates).toHaveLength(1);
		expect(host.revokes).toEqual([]);
		expect(screen.getByTitle("fixture plugin")).toBe(frame);
		expect(connected.messages).toEqual([
			{
				index: 0,
				key: "k0",
				location: home,
				compact: false,
				edgeBack: false,
				leading: "none",
				type: "location",
			},
			{
				index: 1,
				key: "k1",
				compact: true,
				edgeBack: true,
				leading: "back",
				type: "location",
				location: { kind: "route", path: "/items/one", search: "tab=stats" },
			},
		]);
		expect(host.screenStates).toEqual([
			{ index: 0, key: "k0", hasPreviousScreen: false },
			{ index: 1, key: "k1", hasPreviousScreen: true },
		]);

		connectFrame(frame);
		expect(host.screenStates.at(-1)).toBeNull();
		expect(host.creates).toHaveLength(1);
		const replacedStates = [...host.screenStates];
		connected.pluginPort.postMessage({
			index: 1,
			key: "k1",
			type: "screen-state",
			hasPreviousScreen: false,
		});
		await flush();
		expect(host.screenStates).toEqual(replacedStates);
	});

	it("passes entity locations once for equivalent values", async () => {
		const host = renderHost();
		await flush();
		const connected = connectFrame(screen.getByTitle("fixture plugin"));

		connected.pluginPort.postMessage(connected.ready);
		await flush();
		host.moveTo({ overrides: {}, location: entity });
		await flush();

		expect(connected.messages).toContainEqual({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			leading: "none",
			type: "location",
			location: entity,
		});
		const messageCount = connected.messages.length;

		host.moveTo({ overrides: {}, location: { ...entity } });
		await flush();

		expect(connected.messages).toHaveLength(messageCount);
	});

	it.each([
		{ installationId: "installation-2" },
		{ sourceHash: "source-2" },
		{ clientArtifactHash: "artifact-2" },
	] satisfies Array<Partial<PluginClientCatalogEntry>>)(
		"replaces and revokes for identity change %#",
		async (overrides) => {
			const host = renderHost();
			await flush();
			const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
			const connected = connectFrame(frame);
			connected.pluginPort.postMessage(connected.ready);
			await flush();
			connected.pluginPort.postMessage({
				index: 0,
				key: "k0",
				type: "screen-state",
				hasPreviousScreen: false,
			});
			await flush();
			host.screenStates.splice(0);

			host.moveTo({ location: home, overrides });
			await flush();

			expect(host.creates).toHaveLength(2);
			expect(host.screenStates).toContain(null);
			expect(host.revokes).toEqual(["session-1"]);
			expect(screen.getByTitle("fixture plugin")).not.toBe(frame);
			expect(host.events).toEqual([
				"create:artifact-hash",
				"revoke:session-1",
				`create:${overrides.clientArtifactHash ?? "artifact-hash"}`,
			]);
		},
	);

	it("aborts and revokes a late create result under Strict Mode", async () => {
		const first = deferred<PluginArtifactSession>();
		const second = deferred<PluginArtifactSession>();
		let call = 0;
		const recorder = createRecorder({
			create: () => {
				call += 1;
				return call === 1 ? first.promise : second.promise;
			},
		});
		const theme = createTheme();
		render(
			<StrictMode>
				<PluginHost
					theme={theme}
					onHeader={() => {}}
					chromeLeading={null}
					viewport={{ safeAreaTop: 0, safeAreaBottom: 0 }}
					installation={installation}
					onNavigate={() => undefined}
					onOpenDrawer={() => undefined}
					onScreenState={() => undefined}
					onStaleSession={() => undefined}
					onNavigateBack={() => undefined}
					onKernelShortcut={() => undefined}
					chromeTriggerRef={{ current: null }}
					artifactSessionScopeKey="server:user"
					navigation={navigationFor({ location: home })}
					onRenewArtifactSession={recorder.onRenewArtifactSession}
					onCreateArtifactSession={recorder.onCreateArtifactSession}
					onRevokeArtifactSession={recorder.onRevokeArtifactSession}
					onQuery={() => Promise.resolve({ outcome: "failure", reason: "transport" })}
					onAssets={() => Promise.resolve({ outcome: "failure", reason: "transport" })}
					onInvokeOperation={() => Promise.resolve({ outcome: "failure", reason: "transport" })}
				/>
			</StrictMode>,
		);

		expect(recorder.creates).toHaveLength(2);
		expect(recorder.creates[0]?.signal.aborted).toBe(true);
		first.resolve(artifactSession("late"));
		second.resolve(artifactSession("current"));
		await flush();

		expect(recorder.revokes).toEqual(["late"]);
		expect(screen.getByTitle("fixture plugin").getAttribute("src")).toContain("current");
	});

	it("retries creation with a fresh generation", async () => {
		let attempt = 0;
		const recorder = createRecorder({
			create: () => {
				attempt += 1;
				return attempt === 1
					? Promise.reject(new Error("offline"))
					: Promise.resolve(artifactSession("retry"));
			},
		});
		const host = renderHost(recorder);
		await flush();

		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Reload plugin" }));
		await flush();

		expect(recorder.creates).toHaveLength(2);
		expect(recorder.creates[0]?.signal.aborted).toBe(true);
		expect(host.screenStates).toContain(null);
		expect(screen.getByTitle("fixture plugin").getAttribute("src")).toContain("retry");
	});

	it("closes bridge work, revokes, and creates on crash reload", async () => {
		const query = deferred<PluginRyotQLOutcome>();
		const recorder = createRecorder();
		let querySignal: AbortSignal | undefined;
		const host = renderHost(recorder, {}, home, {
			onQuery: (_request, signal) => {
				querySignal = signal;
				signal.addEventListener("abort", () => recorder.events.push("abort:query"));
				return query.promise;
			},
		});
		await flush();
		const connected = connectFrame(screen.getByTitle("fixture plugin"));
		connected.pluginPort.postMessage(connected.ready);
		await flush();
		await flush();
		connected.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "screen-state",
			hasPreviousScreen: false,
		});
		await flush();
		connected.pluginPort.postMessage({
			requestId: "query",
			type: "ryotql-request",
			document: { queries: {} },
		});
		await flush();
		connected.pluginPort.postMessage({ reason: "failed", type: "lifecycle-close" });
		await flush();

		expect(querySignal?.aborted).toBe(true);
		expect(host.screenStates.at(-1)).toBeNull();
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		const clearsBeforeRetry = host.screenStates.filter((state) => state === null).length;
		fireEvent.click(screen.getByRole("button", { name: "Reload plugin" }));
		expect(host.screenStates.filter((state) => state === null).length).toBeGreaterThan(
			clearsBeforeRetry,
		);
		await flush();

		expect(host.revokes).toEqual(["session-1"]);
		expect(host.creates).toHaveLength(2);
		expect(host.events).toEqual([
			"create:artifact-hash",
			"abort:query",
			"revoke:session-1",
			"create:artifact-hash",
		]);
		expect(screen.getByTitle("fixture plugin")).toBeTruthy();
	});

	it("forwards asset requests and aborts them when unmounted", async () => {
		const call = deferred<PluginAssetOutcome>();
		const requests: unknown[] = [];
		let signal: AbortSignal | undefined;
		const host = renderHost(createRecorder(), {}, home, {
			onAssets: (request, requestSignal) => {
				requests.push(request);
				signal = requestSignal;
				return call.promise;
			},
		});
		await flush();
		const connected = connectFrame(screen.getByTitle("fixture plugin"));
		connected.pluginPort.postMessage(connected.ready);
		await flush();
		await flush();

		connected.pluginPort.postMessage({
			requestId: "asset-1",
			type: "asset-request",
			assets: [{ type: "local", key: "permanent/cover.png" }],
		});
		await flush();

		expect(requests).toEqual([{ assets: [{ type: "local", key: "permanent/cover.png" }] }]);
		expect(signal).toBeDefined();

		host.unmount();
		expect(signal?.aborted).toBe(true);
		call.resolve({ outcome: "success", resolutions: [] });
		await flush();

		expect(connected.messages).not.toContainEqual(
			expect.objectContaining({ requestId: "asset-1", type: "asset-result" }),
		);
	});

	it("accepts only the current screen's header", async () => {
		const headers: PluginHeaderPublication[] = [];
		const host = renderHost(createRecorder(), {}, home, {
			onHeader: (header) => headers.push(header),
		});
		await flush();
		const connected = connectFrame(screen.getByTitle("fixture plugin"));
		connected.pluginPort.postMessage(connected.ready);
		await flush();
		await flush();
		connected.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "header",
			header: { title: "Home" },
		});
		await flush();

		host.moveTo({
			index: 1,
			overrides: {},
			location: { kind: "route", path: "/details", search: "" },
		});
		await flush();
		connected.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "header",
			header: { title: "Stale" },
		});
		connected.pluginPort.postMessage({ index: 1, key: "k1", header: null, type: "header" });
		await flush();

		expect(headers).toEqual([
			{ index: 0, key: "k0", title: "Home" },
			{ index: 1, key: "k1", title: null },
		]);
	});

	it("renews five minutes before expiry and retries transient failure before expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
		let renewal = 0;
		const recorder = createRecorder({
			create: () => Promise.resolve(artifactSession("lease", at(10 * 60_000))),
			renew: () => {
				renewal += 1;
				return renewal === 1
					? Promise.reject(new Error("offline"))
					: Promise.resolve({ expiresAt: at(10 * 60_000), outcome: "renewed" });
			},
		});
		renderHost(recorder);
		await flush();

		await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
		expect(recorder.renews).toHaveLength(1);
		await act(async () => vi.advanceTimersByTimeAsync(30_000));

		expect(recorder.renews).toHaveLength(2);
		expect(recorder.creates).toHaveLength(1);
		expect(recorder.revokes).toEqual([]);
	});

	it("replaces at expiry while renewal is still pending", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
		const renewal = deferred<Awaited<ReturnType<RenewPluginArtifactSession>>>();
		const recorder = createRecorder({
			create: () => Promise.resolve(artifactSession("lease", at(6 * 60_000))),
			renew: () => renewal.promise,
		});
		renderHost(recorder);
		await flush();

		await act(async () => vi.advanceTimersByTimeAsync(6 * 60_000));
		await flush();

		expect(recorder.renews).toHaveLength(1);
		expect(recorder.renews[0]?.signal.aborted).toBe(true);
		expect(recorder.revokes).toEqual(["lease"]);
		expect(recorder.creates).toHaveLength(2);
	});

	it("renews on visibility restoration and replaces an expired session", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
		const recorder = createRecorder({
			create: () => Promise.resolve(artifactSession("lease", at(6 * 60_000))),
		});
		renderHost(recorder);
		await flush();
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

		vi.setSystemTime(new Date("2026-08-31T12:02:00.000Z"));
		document.dispatchEvent(new Event("visibilitychange"));
		await flush();
		expect(recorder.renews).toHaveLength(1);

		vi.setSystemTime(new Date("2026-08-31T12:20:00.000Z"));
		document.dispatchEvent(new Event("visibilitychange"));
		await flush();
		expect(recorder.revokes).toEqual(["lease"]);
		expect(recorder.creates).toHaveLength(2);
	});

	it.each(["stale", "not-found"] as const)(
		"replaces a %s renewal and requests catalog refresh",
		async (reason) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
			let refreshes = 0;
			const recorder = createRecorder({
				create: () => Promise.resolve(artifactSession("lease", at(6 * 60_000))),
				renew: () => Promise.resolve({ outcome: "replace", reason }),
			});
			renderHost(recorder, {}, home, {
				onStaleSession: () => {
					refreshes += 1;
				},
			});
			await flush();
			await act(async () => vi.advanceTimersByTimeAsync(60_000));
			await flush();

			expect(refreshes).toBe(1);
			expect(recorder.revokes).toEqual(["lease"]);
			expect(recorder.creates).toHaveLength(2);
		},
	);

	it("aborts lifecycle work and independently revokes on cleanup", async () => {
		const renewal = deferred<Awaited<ReturnType<RenewPluginArtifactSession>>>();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
		const recorder = createRecorder({
			create: () => Promise.resolve(artifactSession("lease", at(6 * 60_000))),
			renew: () => renewal.promise,
		});
		const host = renderHost(recorder);
		await flush();
		await act(async () => vi.advanceTimersByTimeAsync(60_000));
		expect(recorder.renews).toHaveLength(1);

		host.unmount();
		expect(recorder.renews[0]?.signal.aborted).toBe(true);
		expect(recorder.revokes).toEqual(["lease"]);
	});
});
