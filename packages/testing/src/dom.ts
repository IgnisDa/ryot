import { afterAll, afterEach } from "bun:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost:3000",
});
const replace = new Set(["self", "Event", "window", "document", "navigator", "EventTarget"]);

for (const key of Object.getOwnPropertyNames(dom.window)) {
	const member: unknown = Reflect.get(dom.window, key);
	const prototype: unknown =
		typeof member === "function" ? Reflect.get(member, "prototype") : undefined;
	const browserEvent = member === dom.window.Event || prototype instanceof dom.window.Event;
	if (key in globalThis && !replace.has(key) && !browserEvent) {
		continue;
	}
	Object.defineProperty(globalThis, key, {
		writable: true,
		configurable: true,
		value: typeof member === "function" && /^[a-z]/.test(key) ? member.bind(dom.window) : member,
	});
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
	value: true,
	writable: true,
	configurable: true,
});
const { cleanup } = await import("@testing-library/react");
afterEach(cleanup);
afterAll(() => dom.window.close());
