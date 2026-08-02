import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import {
	makeCollectionsApi,
	makeEntityInterestService,
	makeRyotQLApi,
	makeUploadsApi,
} from "#/api/ports.test-layer";
import { createKernelRyotClient } from "#/api/ryot-client";
import { EntitiesService, EntityRouteLoadError } from "#/modules/entities/service";
import type { ThemeStore } from "#/modules/theme/store";

const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "light",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () => ({ resolvedMode: "light" }),
};
const response = {
	data: {
		entity: {
			type: "rows",
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			items: [{ entitySchemaSlug: "book", entitySchemaPluginId: "plugin-1" }],
		},
	},
} as const;

describe("EntitiesService", () => {
	it("executes one focused provenance query through the kernel client", async () => {
		const calls: unknown[] = [];
		const api = makeRyotQLApi({
			execute: (_scope, request) => {
				calls.push(request);
				return Effect.succeed(response);
			},
		});
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				api,
				makeCollectionsApi(),
				makeEntityInterestService(),
				makeUploadsApi(),
				EntitiesService.layer,
			),
		);
		const client = createKernelRyotClient(runtime, scope, theme);

		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(EntitiesService, (service) =>
						service.loadRouteProvenance(client, "entity-1"),
					),
				),
			).resolves.toEqual({ entitySchemaSlug: "book", entitySchemaPluginId: "plugin-1" });
			expect(calls).toHaveLength(1);
			expect(calls[0]).toMatchObject({
				payload: {
					queries: {
						entity: {
							output: { pagination: { limit: 2 } },
							where: { right: { type: "literal", value: "entity-1" } },
						},
					},
				},
			});
		} finally {
			await runtime.dispose();
		}
	});

	it("aborts one in-flight provenance query when its caller cancels", async () => {
		let queryCount = 0;
		let querySignal: AbortSignal | undefined;
		const pending = new Promise<never>(() => undefined);
		let resolveQueryStarted!: () => void;
		const queryStarted = new Promise<void>((resolve) => {
			resolveQueryStarted = resolve;
		});
		const client = createRyotClient(
			createTestRyotAdapter({
				query: (_document, signal) => {
					queryCount += 1;
					querySignal = signal;
					resolveQueryStarted();
					return pending;
				},
			}),
		);
		const runtime = ManagedRuntime.make(EntitiesService.layer);
		const controller = new AbortController();

		try {
			const load = runtime.runPromise(
				Effect.flatMap(EntitiesService, (service) =>
					service.loadRouteProvenance(client, "entity-1"),
				),
				{ signal: controller.signal },
			);
			await queryStarted;

			controller.abort();

			await expect(load).rejects.toBeTruthy();
			expect(queryCount).toBe(1);
			expect(querySignal?.aborted).toBe(true);
		} finally {
			await runtime.dispose();
		}
	});

	it("maps query failures to the route error", async () => {
		const client = createRyotClient(
			createTestRyotAdapter({ query: () => Promise.reject(new Error("query unavailable")) }),
		);
		const runtime = ManagedRuntime.make(EntitiesService.layer);

		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(EntitiesService, (service) =>
						service.loadRouteProvenance(client, "entity-1"),
					),
				),
			).rejects.toBeInstanceOf(EntityRouteLoadError);
		} finally {
			await runtime.dispose();
		}
	});
});
