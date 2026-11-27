import { expect } from "bun:test";

export function assert(value: unknown, message?: string): asserts value {
	expect(value, message).toBeTruthy();
}
