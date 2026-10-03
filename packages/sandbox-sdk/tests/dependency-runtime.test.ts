import {
	configureApprovedDependencyRuntime,
	withApprovedDependencyRuntime,
} from "@ryot-app/sandbox-sdk/dependency-runtime";
import { expect, test } from "vitest";

test("requires trusted initialization and rejects replacement of the configured binding", () => {
	let operations = 0;
	const operation = () => {
		operations += 1;
		return Promise.resolve("result");
	};
	expect(() => withApprovedDependencyRuntime(operation)).toThrow(
		"Approved dependency runtime is not configured",
	);
	expect(operations).toBe(0);
	let calls = 0;
	configureApprovedDependencyRuntime(<A>(callback: () => Promise<A>) => {
		calls += 1;
		return callback();
	});
	expect(() => configureApprovedDependencyRuntime((callback) => callback())).toThrow(
		"Approved dependency runtime is already configured",
	);
	const result = withApprovedDependencyRuntime(operation);
	expect(calls).toBe(1);
	expect(operations).toBe(1);
	return expect(result).resolves.toBe("result");
});
