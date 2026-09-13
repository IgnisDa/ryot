import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeInit,
	type ClientPageContext,
	type PluginLogicalLocation,
	type PluginRouteLocation,
} from "@ryot-app/client-plugin-contract";
import { Modal } from "@ryot-app/client-ui-sdk";
import { EntityId, EntitySchemaSlug, PluginSlug } from "@ryot-app/contract/schema/brands";
import { fireEvent, waitFor } from "@testing-library/dom";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { afterEach, assert, describe, expect, it } from "vitest";

import {
	bootstrapClientPlugin,
	bootstrapClientPage,
	usePageContext,
	usePluginParams,
	usePluginTitle,
	type EntityRendererProps,
} from "./plugin";
import * as pluginSurface from "./plugin";
import { useRyot, useRyotTheme } from "./react";

const metadata = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};
const init: PluginBridgeInit = {
	mode: "light",
	safeAreaTop: 0,
	safeAreaBottom: 0,
	documentKey: "page-1",
	format: metadata.format,
	sessionId: "session-id",
	artifactHash: metadata.hash,
	apiVersion: metadata.apiVersion,
	bridgeVersion: metadata.bridgeVersion,
	compilerVersion: metadata.compilerVersion,
};

const pressMod = (key: string, event: KeyboardEventInit = {}) => {
	fireEvent.keyDown(document, { ...event, key, ctrlKey: true });
	fireEvent.keyDown(document, { ...event, key, metaKey: true });
};
const routeLocation = (path: string, search = ""): PluginRouteLocation => ({
	path,
	search,
	kind: "route",
});
const replacementPage = (label: string): ClientPageContext => ({
	view: null,
	dataSources: null,
	settings: { label },
	route: { params: {} },
	renderer: { kind: "kernel", name: "fixture" },
	target: { path: "/", search: "", kind: "plugin-route", pluginSlug: PluginSlug.make("fixture") },
});
let channels: MessageChannel[] = [];
let bootstraps: Array<{ dispose: () => void }> = [];

const Home = () => {
	const ryot = useRyot();
	const ryotTheme = useRyotTheme();
	const [result, setResult] = useState("pending");
	useEffect(() => {
		void ryot.operations
			.invoke({ input: {}, slug: "greet", pluginSlug: "fixture", output: Schema.String })
			.then(setResult);
	}, [ryot]);
	return <p>{`${ryotTheme.resolvedMode}:${result}`}</p>;
};

const StaticHome = () => <p>Mounted</p>;

const PageContextHome = () => {
	const { target, renderer } = usePageContext();
	return (
		<p>{`${target.kind}:${renderer.kind}:${target.kind === "plugin-route" ? target.pluginSlug : ""}`}</p>
	);
};

const SelectedPage = ({ entityId, entitySchemaSlug }: Partial<EntityRendererProps>) => {
	const { target } = usePageContext();
	const params = usePluginParams();
	return (
		<p>{`${target.kind}:${params.itemId ?? "none"}:${entityId ?? "none"}:${entitySchemaSlug ?? "none"}`}</p>
	);
};

const OverlayHome = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			{open && (
				<Modal label="Overlay" closeLabel="Close" onClose={() => setOpen(false)}>
					<button type="button">Inside</button>
				</Modal>
			)}
		</>
	);
};

const MovieRenderer = ({ entityId, entitySchemaSlug }: EntityRendererProps) => (
	<p>{`${entityId}:${entitySchemaSlug}`}</p>
);

const TitledHome = () => {
	usePluginTitle("Home");
	return <p>Mounted</p>;
};

const TitledDetail = () => {
	const { itemId } = usePluginParams();
	usePluginTitle(`Item ${itemId}`);
	return <p>Mounted</p>;
};

const CrashingHome = () => {
	throw new Error("fatal render");
};

const embedMetadata = () => {
	const element = document.createElement("script");
	element.type = "application/json";
	element.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
	element.textContent = JSON.stringify(metadata);
	document.head.append(element);
};

const mountSelectedPage = (page: ClientPageContext, location: PluginLogicalLocation) => {
	document.body.innerHTML = '<div id="app"></div>';
	embedMetadata();
	bootstraps.push(bootstrapClientPage(SelectedPage));
	const channel = new MessageChannel();
	channels.push(channel);
	channel.port1.start();
	window.dispatchEvent(
		new MessageEvent("message", {
			source: window.parent,
			ports: [channel.port2],
			data: { ...init, page },
		}),
	);
	channel.port1.postMessage({
		index: 0,
		location,
		key: "k0",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
	});
	return channel;
};

afterEach(() => {
	for (const bootstrap of bootstraps) {
		bootstrap.dispose();
	}
	for (const channel of channels) {
		channel.port1.close();
		channel.port2.close();
	}
	channels = [];
	bootstraps = [];
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("bootstrapClientPlugin", () => {
	it("does not expose the removed navigation hook", () => {
		expect(pluginSurface).not.toHaveProperty("usePluginNavigation");
	});

	it("does not register a session without valid embedded metadata", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		bootstraps.push(bootstrapClientPlugin({ home: { component: Home } }));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(messages).toEqual([]);
	});

	it("creates one session client and supplies it through RyotProvider", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: Home } }));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await waitFor(() =>
			expect(messages).toContainEqual(
				expect.objectContaining({ requestId: "operation-1", type: "operation-request" }),
			),
		);
		channel.port1.postMessage({
			value: "Hello",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("light:Hello"));
		channel.port1.postMessage({ mode: "dark", type: "theme" });
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("dark:Hello"));
	});

	it("supplies plugin-route page context through the shared page hook", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: PageContextHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", {
				source: window.parent,
				ports: [channel.port2],
				data: {
					...init,
					page: {
						view: null,
						settings: {},
						dataSources: null,
						route: { params: {} },
						renderer: { kind: "plugin", exportName: "home", pluginId: "plugin-1" },
						target: {
							path: "/",
							search: "tab=stats",
							kind: "plugin-route",
							pluginSlug: PluginSlug.make("plugin-1"),
						},
					},
				},
			}),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/", "tab=stats"),
		});

		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toBe("plugin-route:plugin:plugin-1"),
		);
	});

	it("renders a selected dynamic page at its logical route with prepared params", async () => {
		mountSelectedPage(
			{
				view: null,
				settings: {},
				dataSources: null,
				route: { params: { itemId: "item-1" } },
				renderer: { kind: "plugin", pluginId: "plugin-1", exportName: "details" },
				target: {
					search: "tab=stats",
					kind: "plugin-route",
					path: "/details/item-1",
					pluginSlug: PluginSlug.make("plugin-1"),
				},
			},
			routeLocation("/details/item-1", "tab=stats"),
		);

		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toBe("plugin-route:item-1:none:none"),
		);
	});

	it("replaces page context and remounts page state while keeping the runtime client", async () => {
		const clients: unknown[] = [];
		const Counter = () => {
			const client = useRyot();
			const { settings } = usePageContext();
			const [count, setCount] = useState(0);
			useEffect(() => {
				clients.push(client);
			}, [client]);
			return (
				<button
					type="button"
					onClick={() => setCount((value) => value + 1)}
				>{`${typeof settings.label === "string" ? settings.label : ""}:${count}`}</button>
			);
		};
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPage(Counter));
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		const navigation = {
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location" as const,
			leading: "drawer" as const,
			location: routeLocation("/"),
		};
		window.dispatchEvent(
			new MessageEvent("message", {
				source: window.parent,
				ports: [channel.port2],
				data: { ...init, page: replacementPage("Movies") },
			}),
		);
		channel.port1.postMessage(navigation);
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Movies:0"));
		const button = document.querySelector("button");
		assert(button);
		fireEvent.click(button);
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Movies:1"));
		channel.port1.postMessage({
			navigation,
			type: "document",
			documentKey: "page-2",
			page: replacementPage("Music"),
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Music:0"));
		expect(clients).toHaveLength(2);
		expect(clients[1]).toBe(clients[0]);
	});

	it("renders an already-selected not-found page at the unmatched logical route", async () => {
		mountSelectedPage(
			{
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { kind: "plugin", pluginId: "plugin-1", exportName: "not-found" },
				target: {
					search: "",
					path: "/missing",
					kind: "plugin-route",
					pluginSlug: PluginSlug.make("plugin-1"),
				},
			},
			routeLocation("/missing"),
		);

		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toBe("plugin-route:none:none:none"),
		);
	});

	it("renders a selected entity page with entity renderer props", async () => {
		const channel = mountSelectedPage(
			{
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { kind: "plugin", exportName: "detail", pluginId: "plugin-1" },
				target: {
					kind: "entity",
					entitySchemaPluginId: "plugin-1",
					entityId: EntityId.make("entity-1"),
					entitySchemaSlug: EntitySchemaSlug.make("show"),
				},
			},
			{
				kind: "entity",
				search: "tab=history",
				entityId: EntityId.make("entity-1"),
				entitySchemaSlug: EntitySchemaSlug.make("show"),
			},
		);

		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toBe("entity:none:entity-1:show"),
		);

		channel.port1.postMessage({
			index: 1,
			key: "k1",
			compact: false,
			edgeBack: true,
			leading: "back",
			type: "location",
			location: {
				search: "",
				kind: "entity",
				entityId: EntityId.make("entity-2"),
				entitySchemaSlug: EntitySchemaSlug.make("show"),
			},
		});
		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toContain("entity:none:entity-2:show"),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: {
				kind: "entity",
				search: "tab=history",
				entityId: EntityId.make("entity-1"),
				entitySchemaSlug: EntitySchemaSlug.make("show"),
			},
		});
		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toContain("entity:none:entity-1:show"),
		);
	});

	it("forwards root kernel shortcuts, gates the workspace switcher, and respects overlays", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: OverlayHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		const locate = (compact: boolean) =>
			channel.port1.postMessage({
				compact,
				index: 0,
				key: "k0",
				edgeBack: false,
				type: "location",
				leading: "drawer",
				location: routeLocation("/"),
			});
		const shortcuts = () =>
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "kernel-shortcut",
			);
		locate(false);
		await waitFor(() => expect(document.querySelector("button")?.textContent).toBe("Open"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		pressMod("k");
		pressMod(" ", { code: "Space", shiftKey: true });
		await waitFor(() => expect(shortcuts()).toHaveLength(2));

		locate(true);
		await waitFor(() => expect(document.getElementById("app")?.textContent).toContain("Open"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		pressMod("k");
		pressMod(" ", { code: "Space", shiftKey: true });
		await waitFor(() => expect(shortcuts()).toHaveLength(3));
		expect(shortcuts().at(-1)).toEqual({ type: "kernel-shortcut", shortcut: "command-center" });

		const open = document.querySelector("button");
		assert(open instanceof HTMLButtonElement);
		fireEvent.click(open);
		await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
		await new Promise((resolve) => setTimeout(resolve, 0));
		pressMod("k");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(shortcuts()).toHaveLength(3);
	});

	it("accepts entity renderer registrations during bootstrap", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(
			bootstrapClientPlugin({
				home: { component: StaticHome },
				entities: { "media-movie": { component: MovieRenderer } },
			}),
		);
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "movie",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: {
				search: "",
				kind: "entity",
				entityId: "movie-1",
				entitySchemaSlug: "media-movie",
			},
		});

		await waitFor(() =>
			expect(document.getElementById("app")?.textContent).toBe("movie-1:media-movie"),
		);
	});

	it("publishes the active screen's own title, including after a pop", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(
			bootstrapClientPlugin({
				home: { component: TitledHome },
				routes: [{ path: "/items/$itemId", component: TitledDetail }],
			}),
		);
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		const headers = () =>
			messages.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "header",
			);
		const goTo = async (index: number, key: string, path: string) => {
			channel.port1.postMessage({
				key,
				index,
				compact: false,
				type: "location",
				edgeBack: index > 0,
				location: routeLocation(path),
				leading: index > 0 ? "back" : "drawer",
			});
			await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));
		};

		await goTo(0, "home", "/");
		await waitFor(() =>
			expect(headers()).toEqual([
				{ index: 0, key: "home", type: "header", header: { title: "Home" } },
			]),
		);

		await goTo(1, "detail", "/items/1");
		await waitFor(() =>
			expect(headers().at(-1)).toEqual({
				index: 1,
				key: "detail",
				type: "header",
				header: { title: "Item 1" },
			}),
		);

		await goTo(0, "home", "/");
		await waitFor(() =>
			expect(headers().at(-1)).toEqual({
				index: 0,
				key: "home",
				type: "header",
				header: { title: "Home" },
			}),
		);
	});

	it("does not mount plugin React before the initial location", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: StaticHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.getElementById("app")?.textContent).toBe("");

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.getElementById("app")?.textContent).toBe("");

		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));
	});

	it("contains fatal window errors before activation", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: StaticHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		const error = new ErrorEvent("error", { cancelable: true, error: new Error("fatal") });
		window.dispatchEvent(error);

		await waitFor(() =>
			expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" }),
		);
		expect(error.defaultPrevented).toBe(true);
		expect(document.getElementById("app")?.textContent).toBe("");
	});

	it("contains fatal React render errors", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: CrashingHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});

		await waitFor(() =>
			expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" }),
		);
		expect(document.getElementById("app")?.textContent).toBe("");
		const error = new ErrorEvent("error", { cancelable: true, error: new Error("late") });
		window.dispatchEvent(error);
		expect(error.defaultPrevented).toBe(false);
	});

	it("reports uncaught window errors through the active session", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: StaticHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));

		const error = new ErrorEvent("error", { cancelable: true, error: new Error("uncaught") });
		window.dispatchEvent(error);
		await waitFor(() =>
			expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" }),
		);
		expect(error.defaultPrevented).toBe(true);
	});

	it("reports unhandled rejections and removes session listeners after failure", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		const bootstrap = bootstrapClientPlugin({ home: { component: StaticHome } });
		bootstraps.push(bootstrap);
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));

		const rejection = new Event("unhandledrejection", { cancelable: true });
		window.dispatchEvent(rejection);
		await waitFor(() =>
			expect(messages).toContainEqual({ reason: "failed", type: "lifecycle-close" }),
		);
		expect(rejection.defaultPrevented).toBe(true);

		bootstrap.dispose();
		const lateError = new ErrorEvent("error", { cancelable: true, error: new Error("late") });
		const lateRejection = new Event("unhandledrejection", { cancelable: true });
		window.dispatchEvent(lateError);
		window.dispatchEvent(lateRejection);
		expect(lateError.defaultPrevented).toBe(false);
		expect(lateRejection.defaultPrevented).toBe(false);
	});

	it("removes session listeners on normal disposal", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		const bootstrap = bootstrapClientPlugin({ home: { component: StaticHome } });
		bootstraps.push(bootstrap);
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));

		bootstrap.dispose();
		const error = new ErrorEvent("error", { cancelable: true, error: new Error("late") });
		const rejection = new Event("unhandledrejection", { cancelable: true });
		window.dispatchEvent(error);
		window.dispatchEvent(rejection);
		expect(error.defaultPrevented).toBe(false);
		expect(rejection.defaultPrevented).toBe(false);
	});

	it("removes its window listener when disposed before initialization", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		const bootstrap = bootstrapClientPlugin({ home: { component: Home } });
		bootstrap.dispose();
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();

		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(messages).toEqual([]);
	});

	it("unmounts the React root when the host disposes the runtime", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin({ home: { component: StaticHome } }));
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, source: window.parent, ports: [channel.port2] }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: routeLocation("/"),
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));

		channel.port1.postMessage({ reason: "disposed", type: "lifecycle-close" });

		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe(""));
	});
});
