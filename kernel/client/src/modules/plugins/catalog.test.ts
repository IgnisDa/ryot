import type { PluginThemeSnapshot } from "@ryot-app/client-plugin-contract";
import { createRyotClient } from "@ryot-app/client-sdk";
import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { makeEntityInterestService, makeRyotQLApi, makeUploadsApi } from "#/api/ports.test-layer";
import { createKernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import { PluginCatalogError, PluginCatalogService } from "#/modules/plugins/catalog";
import type { ThemeStore } from "#/modules/theme/store";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const themeSnapshot: PluginThemeSnapshot = { resolvedMode: "light" };
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

const makeCatalogRuntime = (responses: ReadonlyArray<ContractSuccess<"ryotql", "execute">>) => {
	const remaining = [...responses];
	const calls: Array<{ readonly payload: ContractPayload<"ryotql", "execute"> }> = [];
	const api = makeRyotQLApi({
		execute: (_scope, request) => {
			calls.push(request);
			const response = remaining.shift();
			return response === undefined ? Effect.die("no queued response") : Effect.succeed(response);
		},
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(api, makeEntityInterestService(), makeUploadsApi(), PluginCatalogService.layer),
	);

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
