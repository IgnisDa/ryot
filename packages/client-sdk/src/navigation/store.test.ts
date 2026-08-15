import {
	PluginEntityLocation,
	type PluginLogicalLocation,
	type PluginRouteLocation,
} from "@ryot-app/client-plugin-contract";
import { Schema } from "effect";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { createPluginNavigationStore } from "./store";

const Home = () => null;
const Detail = () => null;
const resolve = (location: PluginLogicalLocation) => ({
	params: {},
	element: createElement(location.kind === "route" && location.path === "/" ? Home : Detail),
});
const routeLocation = (path: string, search = ""): PluginRouteLocation => ({
	path,
	search,
	kind: "route",
});
const entityLocation = (entityId: string) =>
	Schema.decodeUnknownSync(PluginEntityLocation)({
		entityId,
		search: "",
		kind: "entity",
		entitySchemaSlug: "media-movie",
	});
const location = (index: number, path: string, key = `k${index}`) => ({
	compact: true,
	edgeBack: index > 0,
	entry: { key, index, location: routeLocation(path) },
	leading: index > 0 ? ("back" as const) : ("drawer" as const),
});

describe("plugin navigation store", () => {
	it("publishes one coherent snapshot for each location", () => {
		const store = createPluginNavigationStore(resolve);
		const snapshots: unknown[] = [];
		store.subscribe(() => snapshots.push(store.getSnapshot()));

		store.setLocation(location(0, "/"));

		expect(snapshots).toHaveLength(1);
		expect(store.getSnapshot()).toMatchObject({
			compact: true,
			edgeBack: false,
			leading: "drawer",
			entry: { index: 0, key: "k0" },
			screens: [{ key: "k0", location: { path: "/", kind: "route" } }],
		});
	});

	it("reconciles a location before a subscriber or router mounts", () => {
		const store = createPluginNavigationStore(resolve);
		store.setLocation(location(0, "/"));

		expect(store.getSnapshot().screens.at(-1)?.element.type).toBe(Home);
	});

	it("restores the retained screen instance on pop", () => {
		const store = createPluginNavigationStore(resolve);
		store.setLocation(location(0, "/"));
		store.setLocation(location(1, "/items/1"));
		const retained = store.getSnapshot().screens.at(-1);
		store.setLocation(location(2, "/items/2"));

		const popped = store.setLocation(location(1, "/items/1"));

		expect(popped.screens.at(-1)).toBe(retained);
		const leaving = popped.transition?.leaving.location;
		if (leaving?.kind !== "route") {
			throw new Error("expected a route location");
		}
		expect(leaving.path).toBe("/items/2");
	});

	it("restores the retained entity screen by history index and key", () => {
		const store = createPluginNavigationStore(resolve);
		const setEntityLocation = (index: number, key = `k${index}`) =>
			store.setLocation({
				compact: true,
				edgeBack: index > 0,
				leading: index > 0 ? "back" : "drawer",
				entry: { key, index, location: entityLocation(`entity-${index}`) },
			});

		setEntityLocation(0);
		setEntityLocation(1);
		const retained = store.getSnapshot().screens.at(-1);
		setEntityLocation(2);
		const popped = setEntityLocation(1);

		expect(popped.screens.at(-1)).toBe(retained);
		expect(popped.transition?.leaving.location).toEqual(entityLocation("entity-2"));
	});

	it("keeps the viewport insets across locations and clears", () => {
		const store = createPluginNavigationStore(resolve, { safeAreaTop: 12, safeAreaBottom: 8 });
		store.setLocation(location(0, "/"));

		expect(store.getSnapshot()).toMatchObject({ safeAreaTop: 12, safeAreaBottom: 8 });

		store.setViewport({ safeAreaTop: 59, safeAreaBottom: 34 });
		store.setLocation(location(1, "/items/1"));

		expect(store.getSnapshot()).toMatchObject({ safeAreaTop: 59, safeAreaBottom: 34 });

		store.clear();

		expect(store.getSnapshot()).toMatchObject({ screens: [], safeAreaTop: 59, safeAreaBottom: 34 });
	});

	it("emits only when a viewport inset actually changes", () => {
		const store = createPluginNavigationStore(resolve, { safeAreaTop: 20, safeAreaBottom: 0 });
		let emissions = 0;
		store.subscribe(() => (emissions += 1));

		store.setViewport({ safeAreaTop: 20, safeAreaBottom: 0 });
		expect(emissions).toBe(0);

		store.setViewport({ safeAreaTop: 44, safeAreaBottom: 0 });
		expect(emissions).toBe(1);

		store.setViewport({ safeAreaTop: 44, safeAreaBottom: 34 });
		expect(emissions).toBe(2);
	});

	it("only completes the current transition", () => {
		const store = createPluginNavigationStore(resolve);
		store.setLocation(location(0, "/"));
		store.setLocation(location(1, "/items/1"));
		const transition = store.setLocation(location(0, "/")).transition;
		if (transition === undefined) {
			throw new Error("expected a pop transition");
		}

		store.completeTransition(transition.id + 1);
		expect(store.getSnapshot().transition).toBe(transition);
		store.completeTransition(transition.id);
		expect(store.getSnapshot().transition).toBeUndefined();
	});
});
