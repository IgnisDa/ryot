import { describe, expect, it } from "@effect/vitest";
import { createRyotClient, RyotClientError } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { Effect, Layer, ManagedRuntime } from "effect";

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
	it.live("executes one focused provenance query through the kernel client", () => {
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

		return Effect.gen(function* () {
			expect(
				yield* Effect.promise(() =>
					runtime.runPromise(
						Effect.flatMap(EntitiesService, (service) =>
							service.loadRouteProvenance(client, "entity-1"),
						),
					),
				),
			).toEqual({ entitySchemaSlug: "book", entitySchemaPluginId: "plugin-1" });
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
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("aborts one in-flight provenance query when its caller cancels", () => {
		let queryCount = 0;
		let querySignal: AbortSignal | undefined;
		let resolveQueryStarted!: () => void;
		// oxlint-disable-next-line effecttsgo/new-promise -- This controllable test gate stays pending until the host callback or test releases it.
		const queryStarted = new Promise<void>((resolve) => {
			resolveQueryStarted = resolve;
		});
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () =>
					Effect.promise((signal) => {
						queryCount += 1;
						querySignal = signal;
						resolveQueryStarted();
						// oxlint-disable-next-line effecttsgo/new-promise -- This test keeps the injected host request pending to verify cancellation or admission.
						return new Promise<never>(() => undefined);
					}),
			}),
		);
		const runtime = ManagedRuntime.make(EntitiesService.layer);
		const controller = new AbortController();

		return Effect.gen(function* () {
			const load = runtime.runPromise(
				Effect.flatMap(EntitiesService, (service) =>
					service.loadRouteProvenance(client, "entity-1"),
				),
				{ signal: controller.signal },
			);
			yield* Effect.promise(() => queryStarted);

			controller.abort();

			yield* Effect.promise(() => expect(load).rejects.toBeTruthy());
			expect(queryCount).toBe(1);
			expect(querySignal?.aborted).toBe(true);
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("maps query failures to the route error", () => {
		const client = createRyotClient(
			createTestRyotAdapter({ query: () => Effect.fail(new RyotClientError("transport")) }),
		);
		const runtime = ManagedRuntime.make(EntitiesService.layer);

		return Effect.promise(() =>
			expect(
				runtime.runPromise(
					Effect.flatMap(EntitiesService, (service) =>
						service.loadRouteProvenance(client, "entity-1"),
					),
				),
			).rejects.toBeInstanceOf(EntityRouteLoadError),
		).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
