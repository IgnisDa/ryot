import type { PluginBridgeNavigate } from "@ryot/contract/modules/plugins/client";
import { waitFor } from "@testing-library/dom";
import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { createRyotClient } from "./index";
import { RyotProvider, useRyot } from "./react";
import {
	createPluginLocationStore,
	PluginLink,
	PluginRouter,
	usePluginParams,
	usePluginSearch,
} from "./routing";

let mountCount = 0;

const ItemRoute = () => {
	const { itemId } = usePluginParams();
	return <p>Item {itemId}</p>;
};

const NotFound = () => <p>Fixture page not found.</p>;

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

const openChannel = () => {
	const messages: unknown[] = [];
	const locations = createPluginLocationStore();
	const send = (path: string, search = "") => locations.set({ path, search });
	const navigate = (
		mode: "push" | "replace",
		to: { path: string; search?: Record<string, string> },
	) => {
		const search = to.search ? new URLSearchParams(to.search).toString() : "";
		messages.push({ mode, type: "navigate", location: { path: to.path, search } });
	};

	return {
		send,
		messages,
		locations,
		client: createRyotClient({ navigate, query: () => Promise.resolve({}) }),
	};
};

const renderRouter = (
	channel: ReturnType<typeof openChannel>,
	routes: Array<{ path: string; component: typeof ItemRoute }>,
	notFound?: typeof NotFound,
) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);

	act(() => {
		const definition = notFound ? { home: Home, routes, notFound } : { home: Home, routes };
		root.render(
			<RyotProvider client={channel.client}>
				<PluginRouter locations={channel.locations} definition={definition} />
			</RyotProvider>,
		);
	});

	return container;
};

const mount = (
	routes: Array<{ path: string; component: typeof ItemRoute }> = [],
	notFound?: typeof NotFound,
) => {
	const channel = openChannel();
	const container = renderRouter(channel, routes, notFound);
	return {
		container,
		messages: channel.messages,
		sendLocation: (path: string, search = "") => act(() => channel.send(path, search)),
	};
};

afterEach(() => {
	for (const root of roots) {
		act(() => root.unmount());
	}
	roots = [];
	mountCount = 0;
});

describe("PluginRouter", () => {
	it("renders nothing before the first location message", () => {
		const { container } = mount();
		expect(container.textContent).toBe("");
	});

	it("renders a location that arrived before the router mounted", async () => {
		const channel = openChannel();
		channel.send("/items/item-9");
		await waitFor(() => expect(channel.locations.getSnapshot()).toBeDefined());

		const container = renderRouter(channel, [{ path: "/items/$itemId", component: ItemRoute }]);

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
					location: { path: "/items/item-1", search: "tab=stats" },
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
					location: { path: "/items/item-2", search: "" },
				} satisfies PluginBridgeNavigate,
				{
					mode: "replace",
					type: "navigate",
					location: { path: "/", search: "" },
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

		sendLocation("/", "tab=stats");
		await waitFor(() => expect(container.textContent).toContain("Tab stats"));
		expect(container.textContent).toContain("Greeted 1 times.");
		expect(mountCount).toBe(1);
	});

	it("moves focus to the route container only after the first rendered location", async () => {
		const { container, sendLocation } = mount();
		sendLocation("/");
		await waitFor(() => expect(container.textContent).toContain("Greeted 0 times."));

		const routeContainer = container.firstElementChild;
		const greetButton = container.querySelector("button");
		if (!greetButton || !(routeContainer instanceof HTMLElement)) {
			throw new Error("expected a route container and a greet button");
		}
		greetButton.focus();
		expect(document.hasFocus()).toBe(true);
		expect(document.activeElement).not.toBe(routeContainer);

		sendLocation("/", "tab=stats");
		await waitFor(() => expect(document.activeElement).toBe(routeContainer));
	});
});
