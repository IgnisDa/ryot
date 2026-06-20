import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot/contract/modules/plugins/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot/contract/modules/ryotql/contract";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { createKernelRyotClient } from "#/api/ryot-client";
import type { ThemeStore } from "#/modules/theme/store";

const scope = { userId: "user-1", serverUrl: "https://ryot.example" };
const document = { queries: {}, output: {} } as PreparedRecipe<unknown>["document"];
const recipe = { document, decode: Result.succeed };
const themeSnapshot = Schema.decodeUnknownSync(PluginThemeSnapshot)({
	resolvedMode: "light",
	tokens: Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name])),
});
const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => themeSnapshot,
};

const makeRuntime = (cause: unknown) =>
	ManagedRuntime.make(
		Layer.succeed(AuthenticatedApi, {
			run: () => Effect.fail(new AuthenticatedApiError({ cause })),
		}),
	);

describe("kernel Ryot client", () => {
	const declaredFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { code: "api-key-rate-limited", retryAfterMs: 30_000 } }),
		new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
		new RyotQLInternalError({ reason: { code: "execution-failed" } }),
	];

	for (const failure of declaredFailures) {
		it(`classifies ${failure._tag} as query-failed`, async () => {
			const runtime = makeRuntime(failure);
			try {
				const client = createKernelRyotClient(runtime, scope, theme);
				await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "query-failed" });
			} finally {
				await runtime.dispose();
			}
		});
	}

	it("classifies an unexpected failure as transport", async () => {
		const runtime = makeRuntime(new TypeError("private network detail"));
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			await expect(client.data.query(recipe)).rejects.toMatchObject({ reason: "transport" });
		} finally {
			await runtime.dispose();
		}
	});

	it("interrupts a query with the caller signal and preserves its abort reason", async () => {
		const runtime = ManagedRuntime.make(
			Layer.succeed(AuthenticatedApi, { run: () => Effect.never }),
		);
		const controller = new AbortController();
		const reason = new DOMException("Caller canceled", "AbortError");
		try {
			const client = createKernelRyotClient(runtime, scope, theme);
			const query = client.data.query(recipe, { signal: controller.signal });

			controller.abort(reason);

			await expect(query).rejects.toBe(reason);
		} finally {
			await runtime.dispose();
		}
	});
});
