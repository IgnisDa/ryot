import type { PreparedRecipe } from "@ryot/ryotql";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createRyotClient, PluginOperationError, RyotQueryError } from "./index";

const Greeting = Schema.Struct({ greeting: Schema.String });
const QueryResponse = Schema.Struct({ value: Schema.String });
const document = { queries: {}, output: {} } as PreparedRecipe<string>["document"];

describe("createRyotClient", () => {
	it("sends only a recipe document and decodes the response locally", async () => {
		const query = (received: typeof document) => {
			expect(received).toBe(document);
			return Promise.resolve({ value: "decoded" });
		};
		const client = createRyotClient({ query, invokeOperation: () => Promise.resolve({}) });
		const recipe: PreparedRecipe<string> = {
			document,
			decode: (response) =>
				Result.map(Schema.decodeUnknownResult(QueryResponse)(response), ({ value }) => value),
		};
		await expect(client.data.query(recipe)).resolves.toBe("decoded");
	});

	it("rejects malformed query and operation results with stable reasons", async () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => Promise.resolve({ greeting: 42 }),
		});
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.fail("invalid") };
		await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "malformed-result" });
		await expect(client.data.query(recipe)).rejects.toBeInstanceOf(RyotQueryError);
		const invocation = { slug: "greet", input: {}, output: Greeting };
		await expect(client.operations.invoke(invocation)).rejects.toMatchObject({
			reason: "malformed-result",
		});
		await expect(client.operations.invoke(invocation)).rejects.toBeInstanceOf(PluginOperationError);
	});

	it("rejects non-JSON adapter output before applying a permissive output schema", async () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => Promise.resolve(() => undefined),
		});

		await expect(
			client.operations.invoke({ slug: "greet", input: null, output: Schema.Unknown }),
		).rejects.toMatchObject({ reason: "malformed-result" });
	});

	it("normalizes unexpected adapter failures as transport errors", async () => {
		const client = createRyotClient({
			query: () => Promise.reject(new Error("network details")),
			invokeOperation: () => Promise.reject(new Error("network details")),
		});
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };
		await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "transport" });
		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toMatchObject({ reason: "transport" });
	});

	it("preserves canonical operation errors from adapters", async () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => Promise.reject(new PluginOperationError("protocol")),
		});

		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toMatchObject({ reason: "protocol" });
	});

	it("rejects invalid JSON input before consulting the adapter", async () => {
		let calls = 0;
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			invokeOperation: () => {
				calls += 1;
				return Promise.resolve({ greeting: "unused" });
			},
		});

		await expect(
			Reflect.apply(client.operations.invoke, client.operations, [
				{ slug: "greet", output: Greeting, input: { invalid: undefined } },
			]),
		).rejects.toMatchObject({ reason: "invalid-input" });
		expect(calls).toBe(0);
	});

	it("rejects operations when the environment does not provide that capability", async () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });

		expect(client.data).not.toHaveProperty("invokeOperation");
		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toMatchObject({ reason: "unsupported-capability" });
	});

	it("delegates navigation through the adapter", () => {
		const navigations: Array<{
			readonly mode: "push" | "replace";
			readonly target: { readonly path: string; readonly search?: Record<string, string> };
		}> = [];
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			navigate: (mode, target) => navigations.push({ mode, target }),
		});

		client.navigation.push({ path: "/items", search: { tab: "stats" } });
		client.navigation.replace({ path: "/" });

		expect(navigations).toEqual([
			{ mode: "push", target: { path: "/items", search: { tab: "stats" } } },
			{ mode: "replace", target: { path: "/" } },
		]);
	});

	it("rejects navigation when the environment does not provide that capability", () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });

		expect(() => client.navigation.push({ path: "/items" })).toThrow(
			new PluginOperationError("unsupported-capability"),
		);
	});
});
