import { describe, expect, it } from "vitest";

import { Route, requireStylexTracer } from "./stylex-tracer-kernel";

describe("StyleX tracer kernel route gate", () => {
	it("rejects normal builds and permits opt-in builds", () => {
		const beforeLoad = Route.options.beforeLoad;
		expect(beforeLoad).toBeTypeOf("function");
		if (typeof beforeLoad !== "function") {
			throw new TypeError("Expected the tracer route to define a beforeLoad gate");
		}
		expect(() => Reflect.apply(beforeLoad, undefined, [{}])).toThrow();
		expect(() => requireStylexTracer(true)).not.toThrow();
	});
});
