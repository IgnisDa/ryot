import { PLUGIN_SCREEN_STACK_LIMIT } from "@ryot-app/contract/modules/plugins/client";
import { describe, expect, it } from "vitest";

import { presentScreens, reconcileStack, type PluginScreen } from "./stack";

const Home = () => null;
const Detail = () => null;

const resolve = (location: { readonly path: string }) => ({
	params: {},
	header: { title: location.path },
	component: location.path === "/" ? Home : Detail,
});

const entry = (index: number, path = `/p${index}`, key = `k${index}`) => ({
	key,
	index,
	location: { path, search: "" },
});

const build = (...indexes: readonly number[]) =>
	indexes.reduce<readonly PluginScreen[]>(
		(stack, index) => reconcileStack(stack, entry(index), resolve).stack,
		[],
	);

describe("reconcileStack", () => {
	it("resets into a single screen when nothing is retained", () => {
		const result = reconcileStack([], entry(0, "/"), resolve);

		expect(result.transition).toBe("reset");
		expect(result.stack).toHaveLength(1);
		expect(result.stack[0]?.component).toBe(Home);
	});

	it("updates the top screen in place when the key is unchanged", () => {
		const stack = build(0);
		const result = reconcileStack(
			stack,
			{ ...entry(0), location: { path: "/p0", search: "tab=stats" } },
			resolve,
		);

		expect(result.transition).toBe("same");
		expect(result.stack).toHaveLength(1);
		expect(result.stack[0]?.location.search).toBe("tab=stats");
	});

	it("replaces the top screen when the index holds but the key changes", () => {
		const stack = build(0, 1);
		const result = reconcileStack(stack, entry(1, "/other", "k1-replaced"), resolve);

		expect(result.transition).toBe("replace");
		expect(result.stack).toHaveLength(2);
		expect(result.stack.at(-1)?.key).toBe("k1-replaced");
	});

	it("pushes the next index onto the stack", () => {
		const result = reconcileStack(build(0), entry(1), resolve);

		expect(result.transition).toBe("push");
		expect(result.stack.map((screen) => screen.key)).toEqual(["k0", "k1"]);
	});

	it("pops back to a retained screen, keeping the entries beneath it", () => {
		const result = reconcileStack(build(0, 1, 2), entry(1), resolve);

		expect(result.transition).toBe("pop");
		expect(result.stack.map((screen) => screen.key)).toEqual(["k0", "k1"]);
	});

	it("keeps the retained screen object across a pop so its state survives", () => {
		const stack = build(0, 1, 2);
		const retained = stack[1];
		const result = reconcileStack(stack, entry(1), resolve);

		expect(result.stack.at(-1)).toBe(retained);
	});

	it("resets when popping to an index the stack never held", () => {
		const result = reconcileStack(build(0, 1, 2), entry(1, "/p1", "different"), resolve);

		expect(result.transition).toBe("reset");
		expect(result.stack).toHaveLength(1);
	});

	it("resets on a jump that is neither the next index nor a retained entry", () => {
		const result = reconcileStack(build(0, 1), entry(7), resolve);

		expect(result.transition).toBe("reset");
		expect(result.stack).toHaveLength(1);
	});

	it("drops the bottom entry once a push exceeds the retention limit", () => {
		const full = build(...Array.from({ length: PLUGIN_SCREEN_STACK_LIMIT }, (_, at) => at));
		const result = reconcileStack(full, entry(PLUGIN_SCREEN_STACK_LIMIT), resolve);

		expect(result.stack).toHaveLength(PLUGIN_SCREEN_STACK_LIMIT);
		expect(result.stack[0]?.key).toBe("k1");
	});
});

describe("presentScreens", () => {
	it("shows only the top screen while idle", () => {
		const roles = presentScreens(build(0, 1, 2), { kind: "idle" }).map(
			(screenEntry) => screenEntry.role,
		);
		expect(roles).toEqual(["hidden", "hidden", "active"]);
	});

	it("shows the screen beneath the top one while a drag is in flight", () => {
		const roles = presentScreens(build(0, 1, 2), { kind: "dragging" }).map(
			(screenEntry) => screenEntry.role,
		);
		expect(roles).toEqual(["hidden", "beneath", "active"]);
	});

	it("shows the incoming screen and keeps the leaving one on top through a pop", () => {
		const stack = build(0, 1);
		const popped = stack.slice(0, 1);
		const leaving = stack[1];
		if (!leaving) {
			throw new Error("expected a leaving screen");
		}
		const presented = presentScreens(popped, {
			from: 0,
			kind: "popping",
			incoming: popped[0]?.key,
			leaving,
		});

		expect(presented.map((screenEntry) => screenEntry.role)).toEqual(["active", "leaving"]);
		expect(presented.at(-1)?.screen).toBe(stack[1]);
		expect(presented.every((screenEntry) => screenEntry.role !== "hidden")).toBe(true);
	});
});
