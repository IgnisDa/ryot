import { describe, expect, it } from "vitest";

import { createBackInterceptors } from "#/modules/navigation/back-interceptors";

describe("createBackInterceptors", () => {
	it("reports that nothing consumed the press when none are registered", () => {
		expect(createBackInterceptors().run()).toBe(false);
	});

	it("lets the most recently registered interceptor consume the press first", () => {
		const calls: Array<string> = [];
		const interceptors = createBackInterceptors();
		interceptors.register(() => {
			calls.push("outer");
			return true;
		});
		interceptors.register(() => {
			calls.push("inner");
			return true;
		});

		expect(interceptors.run()).toBe(true);
		expect(calls).toEqual(["inner"]);
	});

	it("continues past an interceptor that declines the press", () => {
		const calls: Array<string> = [];
		const interceptors = createBackInterceptors();
		interceptors.register(() => {
			calls.push("outer");
			return true;
		});
		interceptors.register(() => {
			calls.push("inner");
			return false;
		});

		expect(interceptors.run()).toBe(true);
		expect(calls).toEqual(["inner", "outer"]);
	});

	it("stops calling an interceptor once it is unregistered", () => {
		let calls = 0;
		const interceptors = createBackInterceptors();
		const unregister = interceptors.register(() => {
			calls += 1;
			return true;
		});

		unregister();

		expect(interceptors.run()).toBe(false);
		expect(calls).toBe(0);
	});
});
