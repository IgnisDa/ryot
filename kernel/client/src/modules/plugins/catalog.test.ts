import { createRyotClient } from "@ryot/client-sdk";
import type { ContractClient, ContractPayload } from "@ryot/contract/client";
import {
	REQUIRED_THEME_TOKEN_NAMES,
	PluginThemeSnapshot,
} from "@ryot/contract/modules/plugins/client";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { createKernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import { PluginCatalogError, PluginCatalogService } from "#/modules/plugins/catalog";
import type { ThemeStore } from "#/modules/theme/store";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
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
const entry = {
	sortOrder: 0,
	icon: "puzzle",
	name: "Fixture",
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
} as const;

const makeCatalogRuntime = (responses: ReadonlyArray<unknown>) => {
	const calls: Array<{ readonly payload: ContractPayload<"ryotql", "execute"> }> = [];
	const execute = (request: { readonly payload: ContractPayload<"ryotql", "execute"> }) => {
		calls.push(request);
		return Effect.succeed(responses[calls.length - 1]);
	};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const contractClient = { ryotql: { execute } } as unknown as ContractClient;
	const api = Layer.succeed(AuthenticatedApi, {
		run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
			program(contractClient).pipe(
				Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
			),
	});
	const runtime = ManagedRuntime.make(Layer.mergeAll(api, PluginCatalogService.layer));

	return { calls, runtime, ryot: createKernelRyotClient(runtime, scope, theme) };
};

describe("plugin catalog service", () => {
	it("loads every catalog page through the direct Ryot client adapter", async () => {
		const nextEntry = { ...entry, slug: "second", installationId: "installation-2" };
		const first = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { hasMore: true, limit: 100, nextCursor: "next-page" },
				},
			},
		};
		const second = {
			data: {
				installations: {
					items: [nextEntry],
					type: "rows" as const,
					pageInfo: { hasMore: false, limit: 100, nextCursor: null },
				},
			},
		};
		const { calls, runtime, ryot } = makeCatalogRuntime([first, second]);

		try {
			const catalog = await runtime.runPromise(
				Effect.flatMap(PluginCatalogService, (service) => service.load(ryot)),
			);

			expect(catalog).toEqual([entry, nextEntry]);
			expect(ryot.theme.getSnapshot()).toEqual(themeSnapshot);
			expect(calls).toHaveLength(2);
			expect(calls[0]?.payload.queries.installations).toMatchObject({
				output: { pagination: { limit: 100 } },
				from: { alias: "installation", table: "pluginInstallation" },
			});
			expect(calls[1]?.payload.queries.installations).toMatchObject({
				output: { pagination: { after: "next-page", limit: 100 } },
			});
		} finally {
			await runtime.dispose();
		}
	});

	it("forwards the Effect cancellation signal to the Ryot client", async () => {
		const signals: Array<AbortSignal | undefined> = [];
		const response = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { hasMore: false, limit: 100, nextCursor: null },
				},
			},
		};
		const ryot = createRyotClient({
			theme,
			query: (_document, signal) => {
				signals.push(signal);
				return Promise.resolve(response);
			},
		});
		const runtime = ManagedRuntime.make(PluginCatalogService.layer);

		try {
			await runtime.runPromise(
				Effect.flatMap(PluginCatalogService, (service) => service.load(ryot)),
			);

			expect(signals).toHaveLength(1);
			expect(signals[0]).toBeInstanceOf(AbortSignal);
		} finally {
			await runtime.dispose();
		}
	});

	it("rejects a page that claims more rows without a cursor", async () => {
		const response = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { hasMore: true, limit: 100, nextCursor: null },
				},
			},
		};
		const { runtime, ryot } = makeCatalogRuntime([response]);

		try {
			await expect(
				runtime.runPromise(Effect.flatMap(PluginCatalogService, (service) => service.load(ryot))),
			).rejects.toBeInstanceOf(PluginCatalogError);
		} finally {
			await runtime.dispose();
		}
	});
});
