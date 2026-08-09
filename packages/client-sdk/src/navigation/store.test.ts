import { describe, expect, it } from "vitest";

import { createPluginNavigationStore } from "./store";

const Home = () => null;
const Detail = () => null;
const resolve = (location: { readonly path: string; readonly search: string }) => ({
	params: {},
	component: location.path === "/" ? Home : Detail,
	header: { title: location.path === "/" ? "Home" : location.path },
});
const location = (index: number, path: string, key = `k${index}`) => ({
	compact: true,
	edgeBack: index > 0,
	entry: { index, key, location: { path, search: "" } },
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
			entry: { index: 0, key: "k0" },
			screens: [{ key: "k0", header: { title: "Home" } }],
		});
	});

	it("reconciles a location before a subscriber or router mounts", () => {
		const store = createPluginNavigationStore(resolve);
		store.setLocation(location(0, "/"));

		expect(store.getSnapshot().screens.at(-1)?.component).toBe(Home);
	});

	it("restores a retained screen and its exact header on pop", () => {
		const store = createPluginNavigationStore(resolve);
		store.setLocation(location(0, "/"));
		store.setLocation(location(1, "/items/1"));
		const retained = store.getSnapshot().screens.at(-1);
		store.setLocation(location(2, "/items/2"));

		const popped = store.setLocation(location(1, "/items/1"));

		expect(popped.screens.at(-1)).toBe(retained);
		expect(popped.screens.at(-1)?.header).toEqual({ title: "/items/1" });
		expect(popped.transition?.leaving.header).toEqual({ title: "/items/2" });
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
