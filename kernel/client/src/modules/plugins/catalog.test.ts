import { describe, expect, it } from "@effect/vitest";
import type { PluginThemeSnapshot } from "@ryot-app/client-plugin-contract";
import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { Effect, Layer, ManagedRuntime } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import {
	makeCollectionsApi,
	makeEntityInterestService,
	makeRyotQLApi,
	makeUploadsApi,
} from "#/api/ports.test-layer";
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
	homeSavedViewSlug: null,
	sourceHash: "source-hash",
	installationId: "installation-1",
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
		Layer.mergeAll(
			api,
			makeCollectionsApi(),
			makeEntityInterestService(),
			makeUploadsApi(),
			PluginCatalogService.layer,
		),
	);

	return { calls, runtime, ryot: createKernelRyotClient(runtime, scope, theme) };
};

describe("plugin catalog service", () => {
	it.live("loads every catalog page through the direct Ryot client adapter", () => {
		const nextEntry = { ...entry, slug: "second", installationId: "installation-2" };
		const first = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { limit: 100, hasMore: true, nextCursor: "next-page" },
				},
			},
		};
		const second = {
			data: {
				installations: {
					items: [nextEntry],
					type: "rows" as const,
					pageInfo: { limit: 100, hasMore: false, nextCursor: null },
				},
			},
		};
		const { ryot, calls, runtime } = makeCatalogRuntime([first, second]);

		return Effect.gen(function* () {
			const catalog = yield* Effect.promise(() =>
				runtime.runPromise(Effect.flatMap(PluginCatalogService, (service) => service.load(ryot))),
			);

			expect(catalog).toEqual([entry, nextEntry]);
			expect(ryot.theme.getSnapshot()).toEqual(themeSnapshot);
			expect(calls).toHaveLength(2);
			expect(calls[0]?.payload.queries.installations).toMatchObject({
				output: { pagination: { limit: 100 } },
				from: { alias: "installation", table: "pluginInstallation" },
			});
			expect(calls[1]?.payload.queries.installations).toMatchObject({
				output: { pagination: { limit: 100, after: "next-page" } },
			});
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("loads the catalog through the Effect client capability", () => {
		const calls: unknown[] = [];
		const response = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { limit: 100, hasMore: false, nextCursor: null },
				},
			},
		};
		const ryot = createRyotClient(
			createTestRyotAdapter({
				theme,
				query: (document) => {
					calls.push(document);
					return Effect.succeed(response);
				},
			}),
		);
		const runtime = ManagedRuntime.make(PluginCatalogService.layer);

		return Effect.gen(function* () {
			yield* Effect.promise(() =>
				runtime.runPromise(Effect.flatMap(PluginCatalogService, (service) => service.load(ryot))),
			);

			expect(calls).toHaveLength(1);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("rejects a page that claims more rows without a cursor", () => {
		const response = {
			data: {
				installations: {
					items: [entry],
					type: "rows" as const,
					pageInfo: { limit: 100, hasMore: true, nextCursor: null },
				},
			},
		};
		const { ryot, runtime } = makeCatalogRuntime([response]);

		return Effect.promise(() =>
			expect(
				runtime.runPromise(Effect.flatMap(PluginCatalogService, (service) => service.load(ryot))),
			).rejects.toBeInstanceOf(PluginCatalogError),
		).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
