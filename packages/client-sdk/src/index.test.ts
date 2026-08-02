import { REQUIRED_THEME_TOKEN_NAMES } from "@ryot/contract/modules/plugins/client";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createRyotClient, RyotClientError } from "./index";

let notify: () => void = () => undefined;
const Greeting = Schema.Struct({ greeting: Schema.String });
const QueryResponse = Schema.Struct({ value: Schema.String });
const document = { queries: {}, output: {} } as PreparedRecipe<string>["document"];
const tokens = Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name]));
const theme = { resolvedMode: "light", tokens };

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
		await expect(client.data.query(recipe)).rejects.toBeInstanceOf(RyotClientError);
		const invocation = { slug: "greet", input: {}, output: Greeting };
		await expect(client.operations.invoke(invocation)).rejects.toMatchObject({
			reason: "malformed-result",
		});
		await expect(client.operations.invoke(invocation)).rejects.toBeInstanceOf(RyotClientError);
	});

	it("classifies a thrown recipe decoder as a malformed result", async () => {
		const client = createRyotClient({ query: () => Promise.resolve({}) });
		const recipe: PreparedRecipe<string> = {
			document,
			decode: () => {
				throw new Error("decoder detail");
			},
		};

		await expect(client.data.query(recipe)).rejects.toEqual(
			new RyotClientError("malformed-result"),
		);
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

	it("preserves canonical client errors from adapters", async () => {
		const error = new RyotClientError("protocol");
		const client = createRyotClient({
			query: () => Promise.reject(error),
			invokeOperation: () => Promise.reject(error),
		});
		const recipe: PreparedRecipe<string> = { document, decode: () => Result.succeed("unused") };

		await expect(client.data.query(recipe)).rejects.toBe(error);
		await expect(
			client.operations.invoke({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toBe(error);
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
			new RyotClientError("unsupported-capability"),
		);
	});

	it("normalizes unexpected navigation failures as transport errors", () => {
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			navigate: () => {
				throw new Error("transport detail");
			},
		});

		expect(() => client.navigation.push({ path: "/items" })).toThrow(
			new RyotClientError("transport"),
		);
	});

	it("decodes theme snapshots and delegates reactive subscriptions", () => {
		let notifications = 0;
		let current: unknown = theme;
		const client = createRyotClient({
			query: () => Promise.resolve({}),
			theme: {
				getSnapshot: () => current,
				subscribe: (listener) => {
					notify = listener;
					return () => {
						notify = () => undefined;
					};
				},
			},
		});

		const initial = client.theme.getSnapshot();
		expect(initial).toEqual(theme);
		expect(client.theme.getSnapshot()).toBe(initial);
		const unsubscribe = client.theme.subscribe(() => {
			notifications += 1;
		});
		current = { resolvedMode: "dark", tokens: { ...tokens, bg: "black" } };
		notify();
		expect(notifications).toBe(1);
		expect(client.theme.getSnapshot()).toEqual(current);
		current = { resolvedMode: "dark", tokens: {} };
		expect(() => notify()).toThrow(new RyotClientError("malformed-result"));
		expect(notifications).toBe(1);
		unsubscribe();
		notify();
		expect(notifications).toBe(1);
	});

	it("rejects missing and malformed theme adapters with shared errors", () => {
		const unsupported = createRyotClient({ query: () => Promise.resolve({}) });
		const malformed = createRyotClient({
			query: () => Promise.resolve({}),
			theme: {
				subscribe: () => () => {},
				getSnapshot: () => ({ resolvedMode: "light", tokens: {} }),
			},
		});

		expect(() => unsupported.theme.getSnapshot()).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() => unsupported.theme.subscribe(() => undefined)).toThrow(
			new RyotClientError("unsupported-capability"),
		);
		expect(() => malformed.theme.getSnapshot()).toThrow(new RyotClientError("malformed-result"));
	});
});
