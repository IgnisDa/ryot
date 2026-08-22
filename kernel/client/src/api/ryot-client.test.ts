import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import {
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot/contract/modules/plugins/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot/contract/modules/ryotql/contract";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { ThemeStore } from "../modules/theme/store";
import { AuthenticatedApi, AuthenticatedApiError } from "./authenticated";
import { createKernelRyotClient } from "./ryot-client";

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
		new AuthRateLimited({ reason: { code: "session-rate-limited", retryAfterMs: 30_000 } }),
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
});
