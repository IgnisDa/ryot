import {
	PluginEntityLocation,
	type PluginBridgeNavigate,
	type PluginLeadingIntent,
	type PluginLogicalLocation,
	type PluginRouteLocation,
} from "@ryot-app/contract/modules/plugins/client";
import { waitFor } from "@testing-library/dom";
import { Schema } from "effect";
import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { createRyotClient } from "./index";
import { createPluginNavigationStore } from "./navigation/store";
import { PluginScreenFrame } from "./plugin-screen";
import { RyotProvider, useRyot } from "./react";
import {
	createPluginRouteResolver,
	PluginLink,
	PluginRouter,
	usePluginParams,
	usePluginSearch,
	usePluginLocation,
	type PluginRouterDefinition,
} from "./routing";

let mountCount = 0;

const ItemRoute = () => {
	const { itemId } = usePluginParams();
	return <p>Item {itemId}</p>;
};

const NotFound = () => <p>Fixture page not found.</p>;

const FramedHome = () => <PluginScreenFrame title="Home">Content</PluginScreenFrame>;

const Home = () => {
	const [greetings, setGreetings] = useState(0);
	const { navigation } = useRyot();
	const tab = usePluginSearch().get("tab");

	useState(() => {
		mountCount += 1;
	});

	return (
		<div>
			<p>Greeted {greetings} times.</p>
			<p>Tab {tab ?? "none"}</p>
			<button type="button" onClick={() => setGreetings((count) => count + 1)}>
				Greet
			</button>
			<PluginLink to="/items/item-1" search={{ tab: "stats" }}>
				Item 1
			</PluginLink>
			<button type="button" onClick={() => navigation.push({ path: "/items/item-2" })}>
				Push item 2
			</button>
			<button type="button" onClick={() => navigation.replace({ path: "/" })}>
				Replace home
			</button>
		</div>
	);
};

let roots: Root[] = [];

const DRAG_START = 1_000;
const DRAG_END = 1_400;

const pointer = (type: string, clientX: number, timeStamp: number) => {
	const event = new PointerEvent(type, { bubbles: true, clientX, clientY: 0, pointerId: 1 });
	Object.defineProperty(event, "timeStamp", { configurable: true, value: timeStamp });
	return event;
};

const routeLocation = (path: string, search = ""): PluginRouteLocation => ({
	path,
	search,
	kind: "route",
});
const entityLocation = (entityId: string, entitySchemaSlug: string) =>
	Schema.decodeUnknownSync(PluginEntityLocation)({ entityId, entitySchemaSlug, kind: "entity" });

let observedLocation: PluginLogicalLocation | undefined;
let observedSearch: URLSearchParams | undefined;
const LocationProbe = () => {
	const location = usePluginLocation();
	const search = usePluginSearch();
	observedLocation = location;
	observedSearch = search;
	return <p>{`${location.kind}:${search.toString()}`}</p>;
};

const openChannel = (
	definition: PluginRouterDefinition = { home: { component: Home } },
	resolve = createPluginRouteResolver(definition),
) => {
	const messages: unknown[] = [];
	const store = createPluginNavigationStore(resolve);
	let compact = false;
	let edgeBack = false;
	let leading: PluginLeadingIntent = "none";
	let position = -1;
	const send = (
		path: string,
		search = "",
		options: { readonly key?: string; readonly index?: number } = {},
	) => {
		position = options.index ?? position + 1;
		store.setLocation({
			compact,
			edgeBack,
			leading,
			entry: {
				index: position,
				key: options.key ?? `k${position}`,
				location: routeLocation(path, search),
			},
		});
	};
	const sendEntity = (
		entityId: string,
		entitySchemaSlug: string,
		options: { readonly key?: string; readonly index?: number } = {},
	) => {
		position = options.index ?? position + 1;
		const location = entityLocation(entityId, entitySchemaSlug);
		store.setLocation({
			compact,
			leading,
			edgeBack,
			entry: { index: position, location, key: options.key ?? `k${position}` },
		});
	};
	const navigate = (
		mode: "push" | "replace",
		to: { path: string; search?: Record<string, string> },
	) => {
		const search = to.search ? new URLSearchParams(to.search).toString() : "";
		messages.push({
			mode,
			type: "navigate",
			location: { kind: "route", path: to.path, search },
		});
	};

	return {
		send,
		store,
		messages,
		sendEntity,
		client: createRyotClient({ navigate, query: () => Promise.resolve({}) }),
		setEdge: (edge: {
			readonly compact: boolean;
			readonly edgeBack: boolean;
			readonly leading?: PluginLeadingIntent;
		}) => {
			compact = edge.compact;
			edgeBack = edge.edgeBack;
			leading = edge.leading ?? leading;
			const { entry } = store.getSnapshot();
			if (entry !== undefined) {
				store.setLocation({ compact, edgeBack, entry, leading });
			}
		},
		navigation: {
			subscribe: store.subscribe,
			getSnapshot: store.getSnapshot,
			completeTransition: store.completeTransition,
			back: () => messages.push({ type: "navigate-back" }),
			openDrawer: () => messages.push({ type: "open-drawer" }),
			publishTitle: (title: string | null) => messages.push({ title, type: "header" }),
		},
	};
};

const renderRouter = (channel: ReturnType<typeof openChannel>) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);

	act(() => {
		root.render(
			<RyotProvider client={channel.client}>
				<PluginRouter navigation={channel.navigation} />
			</RyotProvider>,
		);
	});

	return container;
};

const mount = (
	routes: Array<{ path: string; component: typeof ItemRoute }> = [],
	notFound?: typeof NotFound,
) => {
	const definition = notFound
		? { home: { component: Home }, routes, notFound }
		: { home: { component: Home }, routes };
	const channel = openChannel(definition);
	const container = renderRouter(channel);
	return {
		container,
		store: channel.store,
		messages: channel.messages,
		setEdge: (edge: {
			readonly compact: boolean;
			readonly edgeBack: boolean;
			readonly leading?: PluginLeadingIntent;
		}) => act(() => channel.setEdge(edge)),
		sendLocation: (
			path: string,
			search = "",
			options: { readonly key?: string; readonly index?: number } = {},
		) => act(() => channel.send(path, search, options)),
		sendEntityLocation: (
			entityId: string,
			entitySchemaSlug: string,
			options: { readonly key?: string; readonly index?: number } = {},
		) => act(() => channel.sendEntity(entityId, entitySchemaSlug, options)),
	};
};

afterEach(() => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	mountCount = 0;
	observedSearch = undefined;
	observedLocation = undefined;
});

describe("PluginRouter", () => {
	it("renders nothing before the first location message", () => {
		const { container } = mount();
		expect(container.textContent).toBe("");
	});

	it("renders a location that arrived before the router mounted", async () => {
		const channel = openChannel({
			home: { component: Home },
			routes: [{ path: "/items/$itemId", component: ItemRoute }],
		});
		channel.send("/items/item-9");
		await waitFor(() => expect(channel.store.getSnapshot().entry).toBeDefined());

		const container = renderRouter(channel);

		expect(container.textContent).toContain("Item item-9");
	});

	it("matches a route with a parameter, URL-decoding the segment", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/items/hello%20world");
		await waitFor(() => expect(container.textContent).toContain("Item hello world"));
	});

	it("passes through a param segment that is not valid percent-encoding", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/items/%zz");
		await waitFor(() => expect(container.textContent).toContain("Item %zz"));
	});

	it("renders the default not-found state for an unmatched path", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/does-not-exist");
		await waitFor(() => expect(container.textContent).toContain("Page not found"));
	});

	it("renders a plugin not-found component for an unmatched path", async () => {
		const { container, sendLocation } = mount(
			[{ path: "/items/$itemId", component: ItemRoute }],
			NotFound,
		);
		sendLocation("/does-not-exist");
		await waitFor(() => expect(container.textContent).toContain("Fixture page not found."));
	});

	it("decodes search values through usePluginSearch", async () => {
		const { container, sendLocation } = mount();
		sendLocation("/", "tab=stats");
		await waitFor(() => expect(container.textContent).toContain("Tab stats"));
	});

	it("renders one stable unavailable component for entity locations", async () => {
		const { container, sendEntityLocation, store } = mount([
			{ path: "/items/$itemId", component: ItemRoute },
		]);
		sendEntityLocation("entity-1", "media-movie");
		await waitFor(() => expect(container.textContent).toContain("Entity renderer unavailable"));
		const component = store.getSnapshot().screens[0]?.component;

		sendEntityLocation("entity-2", "media-movie", { index: 0, key: "k0" });
		await waitFor(() => expect(container.textContent).toContain("Entity renderer unavailable"));

		expect(store.getSnapshot().screens[0]?.component).toBe(component);
		expect(store.getSnapshot().screens[0]?.params).toEqual({});
	});

	it("exposes an entity location and empty search through routing hooks", async () => {
		const channel = openChannel(undefined, () => ({ component: LocationProbe, params: {} }));
		const container = renderRouter(channel);

		channel.sendEntity("entity-1", "media-movie");
		await waitFor(() => expect(container.textContent).toBe("entity:"));

		expect(observedLocation).toEqual({
			kind: "entity",
			entityId: "entity-1",
			entitySchemaSlug: "media-movie",
		});
		expect(observedSearch?.toString()).toBe("");
	});

	it("posts an exact PluginBridgeNavigate message on PluginLink click", async () => {
		const { container, messages, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.querySelector("a")).not.toBeNull());

		const link = container.querySelector("a");
		if (!link) {
			throw new Error("expected a rendered plugin link");
		}
		act(() => {
			link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
		});

		await waitFor(() =>
			expect(messages).toEqual([
				{
					mode: "push",
					type: "navigate",
					location: { kind: "route", path: "/items/item-1", search: "tab=stats" },
				} satisfies PluginBridgeNavigate,
			]),
		);
	});

	it("composes click handlers and lets consumers cancel navigation", () => {
		const channel = openChannel();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		let clicks = 0;
		act(() => {
			root.render(
				<RyotProvider client={channel.client}>
					<PluginLink
						to="/items/item-1"
						onClick={(event) => {
							clicks += 1;
							event.preventDefault();
						}}
					>
						Item 1
					</PluginLink>
				</RyotProvider>,
			);
		});
		const link = container.querySelector("a");
		if (!link) {
			throw new Error("expected a rendered plugin link");
		}
		const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
		void act(() => link.dispatchEvent(event));

		expect(clicks).toBe(1);
		expect(event.defaultPrevented).toBe(true);
		expect(channel.messages).toEqual([]);
	});

	it("prevents native navigation on modifier and auxiliary clicks", async () => {
		const { container, messages, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.querySelector("a")).not.toBeNull());

		const link = container.querySelector("a");
		if (!link) {
			throw new Error("expected a rendered plugin link");
		}
		const modified = new MouseEvent("click", {
			button: 0,
			bubbles: true,
			ctrlKey: true,
			cancelable: true,
		});
		const auxiliary = new MouseEvent("auxclick", {
			button: 1,
			bubbles: true,
			cancelable: true,
		});
		void act(() => link.dispatchEvent(modified));
		void act(() => link.dispatchEvent(auxiliary));

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(modified.defaultPrevented).toBe(true);
		expect(auxiliary.defaultPrevented).toBe(true);
		expect(messages).toEqual([]);
	});

	it("posts push and replace navigate messages from the client", async () => {
		const { container, messages, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));

		const [, pushButton, replaceButton] = container.querySelectorAll("button");
		if (!pushButton || !replaceButton) {
			throw new Error("expected navigation buttons");
		}

		void act(() => pushButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		void act(() => replaceButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

		await waitFor(() =>
			expect(messages).toEqual([
				{
					mode: "push",
					type: "navigate",
					location: { kind: "route", path: "/items/item-2", search: "" },
				} satisfies PluginBridgeNavigate,
				{
					mode: "replace",
					type: "navigate",
					location: { kind: "route", path: "/", search: "" },
				} satisfies PluginBridgeNavigate,
			]),
		);
	});

	it("re-renders the route on a second location message without remounting the tree", async () => {
		const { container, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));
		expect(mountCount).toBe(1);

		const greetButton = container.querySelector("button");
		if (!greetButton) {
			throw new Error("expected a greet button");
		}
		void act(() => greetButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		await waitFor(() => expect(container.textContent).toContain("Greeted 1 times."));

		sendLocation("/", "tab=stats", { index: 0 });
		await waitFor(() => expect(container.textContent).toContain("Tab stats"));
		expect(container.textContent).toContain("Greeted 1 times.");
		expect(mountCount).toBe(1);
	});

	it("moves focus to the route container only after the first rendered location", async () => {
		const { container, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));

		const routeContainer = container.querySelector('[tabindex="-1"]');
		const greetButton = container.querySelector("button");
		if (!greetButton || !(routeContainer instanceof HTMLElement)) {
			throw new Error("expected a route container and a greet button");
		}
		greetButton.focus();
		expect(document.hasFocus()).toBe(true);
		expect(document.activeElement).not.toBe(routeContainer);

		sendLocation("/", "tab=stats", { index: 0 });
		await waitFor(() => expect(document.activeElement).toBe(routeContainer));
	});

	it("retains the previous screen across a pop, without remounting it", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));
		expect(mountCount).toBe(1);

		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.textContent).not.toContain("Item item-1"));

		expect(container.textContent).toContain("Greeted 0 times.");
		expect(mountCount).toBe(1);
	});

	it("paints the retained screen instead of hiding it while a compact pop settles", async () => {
		const { container, sendLocation, setEdge } = mount([
			{ path: "/items/$itemId", component: ItemRoute },
		]);
		setEdge({ compact: true, edgeBack: true });
		sendLocation("/");
		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.textContent).not.toContain("Item item-1"));

		const screens = container.querySelectorAll<HTMLElement>('[tabindex="-1"]');
		expect(screens).toHaveLength(1);
		expect(screens[0]?.style.visibility).toBe("visible");
		expect(screens[0]?.style.transform).toBe("");
	});

	it("swaps without retaining a leaving screen when the viewport is not compact", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));
		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(1));

		expect(container.textContent).toContain("Greeted 0 times.");
		expect(mountCount).toBe(1);
	});

	it("keeps a retained screen mounted and inert beneath the top screen", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));

		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		const screens = container.querySelectorAll('[tabindex="-1"]');
		expect(screens).toHaveLength(2);
		expect(screens[0]?.getAttribute("aria-hidden")).toBe("true");
		expect(screens[1]?.getAttribute("aria-hidden")).toBeNull();
	});

	it("renders no back edge until the kernel hands the plugin the edge", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/");
		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		expect(container.querySelector('[data-plugin-edge="back"]')).toBeNull();
	});

	it("keeps the visible leading intent independent from back-edge ownership", async () => {
		const channel = openChannel({ home: { component: FramedHome } });
		channel.setEdge({ compact: true, edgeBack: false, leading: "back" });
		const container = renderRouter(channel);
		act(() => channel.send("/"));

		await waitFor(() => expect(container.querySelector('[aria-label="Go back"]')).not.toBeNull());
		expect(container.querySelector('[aria-label="Open navigation"]')).toBeNull();
		expect(container.querySelector('[data-plugin-edge="back"]')).toBeNull();

		act(() => channel.setEdge({ compact: true, edgeBack: true, leading: "drawer" }));
		await waitFor(() =>
			expect(container.querySelector('[aria-label="Open navigation"]')).not.toBeNull(),
		);
		expect(container.querySelector('[aria-label="Go back"]')).toBeNull();
		expect(container.querySelector('[data-plugin-edge="back"]')).not.toBeNull();

		act(() => channel.setEdge({ compact: true, edgeBack: true, leading: "none" }));
		await waitFor(() => expect(container.querySelector("button")).toBeNull());
		expect(container.querySelector('[data-plugin-edge="back"]')).not.toBeNull();
	});

	it("posts one navigate-back when an edge drag passes the commit threshold", async () => {
		const { container, messages, sendLocation, setEdge } = mount([
			{ path: "/items/$itemId", component: ItemRoute },
		]);
		sendLocation("/");
		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));
		setEdge({ compact: true, edgeBack: true });

		const edge = container.querySelector('[data-plugin-edge="back"]');
		const root = container.firstElementChild;
		if (!(edge instanceof HTMLElement) || !(root instanceof HTMLElement)) {
			throw new Error("expected a plugin edge strip inside a router root");
		}
		Object.defineProperty(root, "clientWidth", { configurable: true, value: 300 });

		act(() => {
			edge.dispatchEvent(pointer("pointerdown", 2, DRAG_START));
			edge.dispatchEvent(pointer("pointermove", 160, DRAG_END));
			edge.dispatchEvent(pointer("pointerup", 160, DRAG_END));
		});

		const committing = container.querySelectorAll<HTMLElement>('[tabindex="-1"]');
		expect(committing).toHaveLength(2);
		for (const screen of committing) {
			expect(screen.style.visibility).toBe("visible");
		}

		await waitFor(() => expect(messages).toEqual([{ type: "navigate-back" }]));

		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(1));
		expect(container.textContent).not.toContain("Item item-1");
	});

	it("posts nothing when an edge drag is released below the commit threshold", async () => {
		const { container, messages, sendLocation, setEdge } = mount([
			{ path: "/items/$itemId", component: ItemRoute },
		]);
		sendLocation("/");
		sendLocation("/items/item-1");
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));
		setEdge({ compact: true, edgeBack: true });

		const edge = container.querySelector('[data-plugin-edge="back"]');
		const root = container.firstElementChild;
		if (!(edge instanceof HTMLElement) || !(root instanceof HTMLElement)) {
			throw new Error("expected a plugin edge strip inside a router root");
		}
		Object.defineProperty(root, "clientWidth", { configurable: true, value: 300 });

		act(() => {
			edge.dispatchEvent(pointer("pointerdown", 2, DRAG_START));
			edge.dispatchEvent(pointer("pointermove", 30, DRAG_END));
			edge.dispatchEvent(pointer("pointerup", 30, DRAG_END));
		});

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(messages).toEqual([]);
	});

	it("keeps exactly one screen per history entry across back and forward", async () => {
		const { container, sendLocation } = mount([{ path: "/items/$itemId", component: ItemRoute }]);
		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));

		sendLocation("/items/item-1", "", { index: 1 });
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(1));

		sendLocation("/items/item-1", "", { index: 1 });
		await waitFor(() => expect(container.textContent).toContain("Item item-1"));

		sendLocation("/", "", { index: 0 });
		await waitFor(() => expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(1));
		expect(mountCount).toBe(1);
	});
});
