import {
	PluginEntityLocation,
	type PluginBridgeNavigate,
	type PluginLeadingIntent,
	type PluginLogicalLocation,
	type PluginRouteLocation,
} from "@ryot-app/client-plugin-contract";
import { EntityId, PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { waitFor } from "@testing-library/dom";
import { Match, Schema } from "effect";
import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import type {
	RyotClientAdapter,
	RyotNavigationTarget,
	EntityInterest,
	EntityUpdate,
} from "./index";
import { createPluginNavigationStore, type PluginRouterNavigation } from "./navigation/store";
import { PluginScreenFrame } from "./plugin-screen";
import { RyotProvider, useRyot, useEntityRefresh } from "./react";
import {
	createPluginRouteResolver,
	PluginLink,
	PluginRouter,
	usePluginParams,
	usePluginSearch,
	usePluginLocation,
	type EntityRendererProps,
	type PluginRouterDefinition,
} from "./routing";
import { createTestRyotClock } from "./testing";

let mountCount = 0;
let entityMountCount = 0;
const pluginSlug = "fixture";

const ItemRoute = () => {
	const { itemId } = usePluginParams();
	return <p>Item {itemId}</p>;
};

const NewItemRoute = () => <p>New item</p>;

const NotFound = () => <p>Fixture page not found.</p>;

const FramedHome = () => <PluginScreenFrame title="Home">Content</PluginScreenFrame>;

const EntityRenderer = ({ entityId, entitySchemaSlug }: EntityRendererProps) => {
	const [count, setCount] = useState(0);
	useState(() => {
		entityMountCount += 1;
	});

	return (
		<div>
			<p>{`${entityId}:${entitySchemaSlug}:${count}`}</p>
			<button type="button" onClick={() => setCount((value) => value + 1)}>
				Increment entity
			</button>
		</div>
	);
};

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
			<PluginLink
				to={{ pluginSlug, kind: "plugin-route", path: "/items/item-1", search: { tab: "stats" } }}
			>
				Item 1
			</PluginLink>
			<button
				type="button"
				onClick={() => navigation.push({ pluginSlug, kind: "plugin-route", path: "/items/item-2" })}
			>
				Push item 2
			</button>
			<button
				type="button"
				onClick={() => navigation.replace({ pluginSlug, kind: "plugin-route", path: "/" })}
			>
				Replace home
			</button>
		</div>
	);
};

let roots: Root[] = [];
let clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

const makeClock = (
	overrides: Partial<RyotClientAdapter> = {},
	navigation?: PluginRouterNavigation,
) => {
	const clock = createTestRyotClock(overrides, navigation);
	clocks.push(clock);
	return clock;
};

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
const entityLocation = (entityId: string, entitySchemaSlug: string, search = "") =>
	Schema.decodeUnknownSync(PluginEntityLocation)({
		search,
		entityId,
		kind: "entity",
		entitySchemaSlug,
	});

let observedSearch: URLSearchParams | undefined;
let observedParams: Record<string, string> | undefined;
let observedLocation: PluginLogicalLocation | undefined;

const LocationProbe = () => {
	const params = usePluginParams();
	const search = usePluginSearch();
	const location = usePluginLocation();
	observedLocation = location;
	observedParams = params;
	observedSearch = search;
	return <p>{`${location.kind}:${search.toString()}`}</p>;
};

const openChannel = (
	definition: PluginRouterDefinition = { home: { component: Home } },
	resolve = createPluginRouteResolver(definition),
	adapter: Partial<RyotClientAdapter> = {},
) => {
	const messages: unknown[] = [];
	const store = createPluginNavigationStore(resolve);
	const navigation: PluginRouterNavigation = {
		subscribe: store.subscribe,
		getSnapshot: store.getSnapshot,
		registerShortcut: () => () => undefined,
		completeTransition: store.completeTransition,
		back: () => messages.push({ type: "navigate-back" }),
		openDrawer: () => messages.push({ type: "open-drawer" }),
		publishTitle: (title: string | null) => messages.push({ title, type: "header" }),
	};
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
		options: { readonly key?: string; readonly index?: number; readonly search?: string } = {},
	) => {
		position = options.index ?? position + 1;
		const location = entityLocation(entityId, entitySchemaSlug, options.search);
		store.setLocation({
			compact,
			leading,
			edgeBack,
			entry: { location, index: position, key: options.key ?? `k${position}` },
		});
	};
	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		const target: PluginBridgeNavigate["target"] = Match.value(to).pipe(
			Match.when({ kind: "plugin-route" }, ({ path, pluginSlug: targetPlugin, search }) => ({
				path,
				kind: "plugin-route" as const,
				pluginSlug: PluginSlug.make(targetPlugin),
				search: search === undefined ? "" : new URLSearchParams(search).toString(),
			})),
			Match.when({ kind: "entity" }, ({ entityId }) => ({
				kind: "entity" as const,
				entityId: EntityId.make(entityId),
			})),
			Match.when({ kind: "saved-view" }, ({ savedViewId }) => ({
				kind: "saved-view" as const,
				savedViewId: SavedViewId.make(savedViewId),
			})),
			Match.exhaustive,
		);
		messages.push({ mode, target, type: "navigate" });
	};

	return {
		send,
		store,
		messages,
		sendEntity,
		navigation,
		clock: makeClock({ navigate, ...adapter }, navigation),
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
	};
};

const renderRouter = (channel: ReturnType<typeof openChannel>) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);

	act(() => {
		root.render(
			<RyotProvider runtime={channel.clock.runtime}>
				<PluginRouter />
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

afterEach(async () => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	await Promise.all(clocks.map((clock) => clock.dispose()));
	clocks = [];
	mountCount = 0;
	entityMountCount = 0;
	observedParams = undefined;
	observedSearch = undefined;
	observedLocation = undefined;
});

describe("PluginRouter", () => {
	it("withdraws retained-screen interest and waits for running refresh before pop catch-up", async () => {
		let hint!: (event: EntityUpdate) => void;
		let watches = 0;
		let disposals = 0;
		const watchEntities = (_interest: EntityInterest, listener: typeof hint) => {
			watches++;
			hint = listener;
			return {
				dispose: () => {
					disposals++;
				},
				update: () => undefined,
			};
		};
		const pending: Array<() => void> = [];
		const onRefresh = () => new Promise<void>((resolve) => pending.push(resolve));
		const InterestedHome = () => {
			useEntityRefresh({
				identity: "home",
				blocked: false,
				onRefresh,
				interest: { foreground: ["root"], visible: [] },
			});
			return <p>Interested home</p>;
		};
		const definition = {
			home: { component: InterestedHome },
			routes: [{ path: "/item", component: ItemRoute }],
		};
		const channel = openChannel(definition, createPluginRouteResolver(definition), {
			watchEntities,
		});
		const container = renderRouter(channel);
		act(() => channel.send("/", "", { index: 0, key: "home" }));
		expect(watches).toBe(1);
		act(() => hint({ entityId: "root", reason: "populated" }));
		await channel.clock.advance(250);
		expect(pending).toHaveLength(1);
		act(() => channel.send("/item"));
		expect(disposals).toBe(1);
		expect(container.textContent).toContain("Interested home");
		act(() => channel.send("/", "", { index: 0, key: "home" }));
		expect(watches).toBe(2);
		await channel.clock.advance(300);
		expect(pending).toHaveLength(1);
		await act(async () => {
			pending[0]?.();
			await Promise.resolve();
		});
		await channel.clock.advance(250);
		expect(pending).toHaveLength(2);
	});

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

	it("matches a static route before an overlapping dynamic route", async () => {
		const channel = openChannel({
			home: { component: Home },
			routes: [
				{ path: "/items/$itemId", component: ItemRoute },
				{ path: "/items/new", component: NewItemRoute },
			],
		});
		const container = renderRouter(channel);
		act(() => channel.send("/items/new"));
		await waitFor(() => expect(container.textContent).toContain("New item"));
		expect(container.textContent).not.toContain("Item new");
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

	it("renders one stable unavailable component for unregistered entity locations", async () => {
		const { container, sendEntityLocation, store } = mount([
			{ path: "/items/$itemId", component: ItemRoute },
		]);
		sendEntityLocation("entity-1", "media-movie");
		await waitFor(() => expect(container.textContent).toContain("Entity renderer unavailable"));
		const component = store.getSnapshot().screens[0]?.element.type;

		sendEntityLocation("entity-2", "media-movie", { index: 0, key: "k0" });
		await waitFor(() => expect(container.textContent).toContain("Entity renderer unavailable"));

		expect(store.getSnapshot().screens[0]?.element.type).toBe(component);
		expect(store.getSnapshot().screens[0]?.params).toEqual({});
	});

	it("selects a registered entity renderer and passes its location props", async () => {
		const channel = openChannel({
			home: { component: Home },
			entities: { "media-movie": { component: EntityRenderer } },
		});
		const container = renderRouter(channel);

		act(() => channel.sendEntity("movie-1", "media-movie"));
		await waitFor(() => expect(container.textContent).toContain("movie-1:media-movie:0"));

		expect(channel.store.getSnapshot().screens[0]?.element.type).toBe(EntityRenderer);
		expect(channel.store.getSnapshot().screens[0]?.params).toEqual({});
	});

	it("uses the unavailable renderer for an unrelated entity schema", async () => {
		const channel = openChannel({
			home: { component: Home },
			entities: { "media-movie": { component: EntityRenderer } },
		});
		const container = renderRouter(channel);

		act(() => channel.sendEntity("show-1", "media-show"));
		await waitFor(() => expect(container.textContent).toContain("Entity renderer unavailable"));

		expect(channel.store.getSnapshot().screens[0]?.element.type).not.toBe(EntityRenderer);
	});

	it("retains the registered renderer state across a pop without a wrapper remount", async () => {
		const channel = openChannel({
			home: { component: Home },
			entities: { "media-movie": { component: EntityRenderer } },
		});
		const container = renderRouter(channel);

		act(() => channel.sendEntity("movie-1", "media-movie", { index: 0, key: "movie-1" }));
		await waitFor(() => expect(container.textContent).toContain("movie-1:media-movie:0"));
		const increment = container.querySelector("button");
		if (!increment) {
			throw new Error("expected an entity renderer button");
		}
		void act(() => increment.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		await waitFor(() => expect(container.textContent).toContain("movie-1:media-movie:1"));

		act(() => channel.sendEntity("movie-2", "media-movie", { index: 1, key: "movie-2" }));
		await waitFor(() => expect(container.textContent).toContain("movie-2:media-movie:0"));
		expect(entityMountCount).toBe(2);

		act(() => channel.sendEntity("movie-1", "media-movie", { index: 0, key: "movie-1" }));
		await waitFor(() => expect(container.textContent).toContain("movie-1:media-movie:1"));

		expect(entityMountCount).toBe(2);
		expect(channel.store.getSnapshot().screens.at(-1)?.element.type).toBe(EntityRenderer);
	});

	it("exposes an entity location and its search through routing hooks", async () => {
		const channel = openChannel(undefined, () => ({ element: <LocationProbe />, params: {} }));
		const container = renderRouter(channel);

		channel.sendEntity("entity-1", "media-movie", { search: "dialog=details" });
		await waitFor(() => expect(container.textContent).toBe("entity:dialog=details"));

		expect(observedLocation).toEqual({
			kind: "entity",
			entityId: "entity-1",
			search: "dialog=details",
			entitySchemaSlug: "media-movie",
		});
		expect(observedParams).toEqual({});
		expect(observedSearch?.toString()).toBe("dialog=details");
	});

	it("posts an exact PluginBridgeNavigate message on PluginLink click", async () => {
		const { container, messages, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.querySelector("a")).not.toBeNull());

		const link = container.querySelector("a");
		if (!link) {
			throw new Error("expected a rendered plugin link");
		}
		expect(link.getAttribute("href")).toBe("/fixture/items/item-1?tab=stats");
		act(() => {
			link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
		});

		await waitFor(() =>
			expect(messages).toEqual([
				{
					mode: "push",
					type: "navigate",
					target: {
						search: "tab=stats",
						kind: "plugin-route",
						path: "/items/item-1",
						pluginSlug: PluginSlug.make(pluginSlug),
					},
				} satisfies PluginBridgeNavigate,
			]),
		);
	});

	it("derives an encoded entity href and dispatches an entity target", () => {
		const channel = openChannel();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		roots.push(root);
		act(() => {
			root.render(
				<RyotProvider runtime={channel.clock.runtime}>
					<PluginLink to={{ kind: "entity", entityId: "entity/1" }}>Entity 1</PluginLink>
				</RyotProvider>,
			);
		});

		const link = container.querySelector("a");
		if (!link) {
			throw new Error("expected a rendered plugin link");
		}
		expect(link.getAttribute("href")).toBe("/e/entity%2F1");
		act(() => {
			link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
		});

		expect(channel.messages).toEqual([
			{
				mode: "push",
				type: "navigate",
				target: { kind: "entity", entityId: EntityId.make("entity/1") },
			} satisfies PluginBridgeNavigate,
		]);
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
				<RyotProvider runtime={channel.clock.runtime}>
					<PluginLink
						to={{ pluginSlug, kind: "plugin-route", path: "/items/item-1" }}
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
		const auxiliary = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
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
					target: {
						search: "",
						kind: "plugin-route",
						path: "/items/item-2",
						pluginSlug: PluginSlug.make(pluginSlug),
					},
				} satisfies PluginBridgeNavigate,
				{
					mode: "replace",
					type: "navigate",
					target: {
						path: "/",
						search: "",
						kind: "plugin-route",
						pluginSlug: PluginSlug.make(pluginSlug),
					},
				} satisfies PluginBridgeNavigate,
			]),
		);
	});

	it("preserves focus and state when the active entry key is unchanged", async () => {
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
		greetButton.focus();

		sendLocation("/", "tab=stats", { index: 0, key: "k0" });
		await waitFor(() => expect(container.textContent).toContain("Tab stats"));
		expect(container.textContent).toContain("Greeted 1 times.");
		expect(mountCount).toBe(1);
		expect(document.activeElement).toBe(greetButton);
	});

	it("remounts the active screen for an ordinary same-index history replacement", async () => {
		const { container, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));
		const greetButton = container.querySelector("button");
		if (!greetButton) {
			throw new Error("expected a greet button");
		}
		void act(() => greetButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		await waitFor(() => expect(container.textContent).toContain("Greeted 1 times."));

		sendLocation("/", "tab=stats", { index: 0, key: "k0-replaced" });

		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));
		expect(mountCount).toBe(2);
	});

	it("moves focus to the route container only when the active entry changes", async () => {
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

		sendLocation("/", "tab=stats", { index: 1, key: "k1" });
		await waitFor(() => {
			const activeRouteContainer = [
				...container.querySelectorAll<HTMLElement>('[tabindex="-1"]'),
			].at(-1);
			expect(document.activeElement).toBe(activeRouteContainer);
		});
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
