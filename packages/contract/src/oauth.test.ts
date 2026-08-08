import { describe, expect, it } from "vitest";

import { isLoopbackOrigin } from "./oauth";

describe("isLoopbackOrigin", () => {
	it.each([
		"http://localhost:3005",
		"http://127.0.0.1:3000",
		"http://127.5.5.5",
		"http://[::1]:8000",
		"http://tenant.localhost",
	])("treats %s as loopback", (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(true);
	});

	it.each([
		"http://192.168.1.50:8000",
		"http://10.0.0.4",
		"http://ryot.lan",
		"http://notlocalhost",
		"https://app.ryot.io",
	])("treats %s as routable", (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(false);
	});
});
