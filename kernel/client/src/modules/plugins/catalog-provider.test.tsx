import { describe, expect, it } from "@effect/vitest";
import { RyotProvider } from "@ryot-app/client-sdk/react";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";
import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot-app/contract/modules/plugins/contract";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime, Schedule } from "effect";
import type { ReactNode } from "react";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { OAuthTokenService } from "#/modules/auth/token-service";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogProvider, usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { makePluginCatalogEventsLayer } from "#/modules/plugins/events";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		icon: "puzzle",
		name: "Fixture",
		slug: "fixture",
		health: "ready",
		isHidden: false,
		clientApiVersion: 1,
		pluginId: "plugin-1",
		homeSavedViewSlug: null,
		sourceHash: "source-hash",
		installationId: "installation-1",
	},
];
const ryot = createTestRyotClock();

function CatalogConsumer(props: { readonly name: string }) {
	const { refetch, catalog: current, invalidationRevision } = usePluginCatalog();
	return (
		<div>
			<p>{`${props.name}:${current.map((entry) => entry.sourceHash).join(",")}`}</p>
			<p>{`${props.name}-revision:${invalidationRevision}`}</p>
			<button type="button" onClick={refetch}>
				{`Refresh ${props.name}`}
			</button>
		</div>
	);
}

const makeView = (
	load: PluginCatalogService["Service"]["load"],
	children: ReactNode = <CatalogConsumer name="catalog" />,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(events.layer, Layer.succeed(PluginCatalogService, { load })),
	);
	const tree = (content: ReactNode) => (
		<RyotProvider runtime={ryot.runtime} hostServices={{ scope, runtime }}>
			<PluginCatalogProvider scope={scope} runtime={runtime} initialCatalog={catalog}>
				{content}
			</PluginCatalogProvider>
		</RyotProvider>
	);
	const view = render(tree(children));
	return {
		...view,
		tree,
		events,
		runtime,
		removeProvider: () => view.rerender(<RyotProvider runtime={ryot.runtime}>{null}</RyotProvider>),
	};
};

describe("plugin catalog provider", () => {
	it.live("does not query when the catalog stream acknowledges its connection", () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		let loads = 0;
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				Layer.succeed(PluginCatalogService, {
					load: () =>
						Effect.sync(() => {
							loads += 1;
							return catalog;
						}),
				}),
				makePluginCatalogEventsLayer(
					() =>
						Promise.resolve({
							ok: true,
							status: 200,
							body: new ReadableStream<Uint8Array>({
								start: (value) => {
									controller = value;
								},
							}),
						}),
					Schedule.spaced("1 millis"),
				).pipe(
					Layer.provide(
						Layer.succeed(OAuthTokenService, {
							clear: () => Effect.void,
							logout: () => Effect.succeed(null),
							userInfo: () => Effect.succeed(null),
							accessToken: () => Effect.succeed("token"),
							rejectAuthorization: () => Effect.die("not used"),
							completeAuthorization: () => Effect.die("not used"),
						}),
					),
				),
			),
		);
		const view = render(
			<RyotProvider runtime={ryot.runtime} hostServices={{ scope, runtime }}>
				<PluginCatalogProvider scope={scope} runtime={runtime} initialCatalog={catalog}>
					<CatalogConsumer name="catalog" />
				</PluginCatalogProvider>
			</RyotProvider>,
		);
		return Effect.gen(function* () {
			yield* Effect.promise(() => waitFor(() => expect(controller).toBeDefined()));
			act(() =>
				controller?.enqueue(
					new TextEncoder().encode(`event: ${PLUGIN_CATALOG_CONNECTED_EVENT}\ndata:\n\n`),
				),
			);
			yield* Effect.promise(() => waitFor(() => expect(controller?.desiredSize).toBe(1)));
			expect(loads).toBe(0);
			expect(screen.getByText("catalog-revision:0")).toBeTruthy();
			act(() =>
				controller?.enqueue(
					new TextEncoder().encode(`event: ${PLUGIN_CATALOG_INVALIDATED_EVENT}\ndata:\n\n`),
				),
			);
			yield* Effect.promise(() => waitFor(() => expect(loads).toBe(1)));
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => view.unmount()).pipe(
					Effect.andThen(Effect.promise(() => runtime.dispose())),
				),
			),
		);
	});

	it.live("hydrates without a duplicate load and publishes event refreshes", () =>
		Effect.gen(function* () {
			let loads = 0;
			let current = catalog;
			const view = makeView(() =>
				Effect.sync(() => {
					loads += 1;
					return current;
				}),
			);

			expect(screen.getByText("catalog:source-hash")).toBeTruthy();
			expect(screen.getByText("catalog-revision:0")).toBeTruthy();
			yield* Effect.promise(() => waitFor(() => expect(view.events.isSubscribed()).toBe(true)));
			expect(loads).toBe(0);

			current = [{ ...catalog[0], sourceHash: "updated-source-hash" }];
			act(() => view.events.send());

			yield* Effect.promise(() => screen.findByText("catalog:updated-source-hash"));
			expect(loads).toBe(1);
			expect(screen.getByText("catalog-revision:1")).toBeTruthy();
			expect(view.events.getSubscriptionCount()).toBe(1);
			view.unmount();
			yield* Effect.promise(() => view.runtime.dispose());
		}),
	);

	it.live("keeps one subscription across child rerenders and multiple consumers", () =>
		Effect.gen(function* () {
			const view = makeView(
				() => Effect.die("not used"),
				<>
					<CatalogConsumer name="first" />
					<CatalogConsumer name="second" />
				</>,
			);

			yield* Effect.promise(() => waitFor(() => expect(view.events.isSubscribed()).toBe(true)));
			expect(view.events.getSubscriptionCount()).toBe(1);

			view.rerender(
				view.tree(
					<>
						<CatalogConsumer name="first" />
						<CatalogConsumer name="second" />
						<CatalogConsumer name="third" />
					</>,
				),
			);

			expect(screen.getByText("third:source-hash")).toBeTruthy();
			expect(view.events.getSubscriptionCount()).toBe(1);
			view.unmount();
			yield* Effect.promise(() => view.runtime.dispose());
		}),
	);

	it.live("interrupts the subscription and prevents refreshes after unmount", () =>
		Effect.gen(function* () {
			let loads = 0;
			const view = makeView(() =>
				Effect.sync(() => {
					loads += 1;
					return catalog;
				}),
			);
			yield* Effect.promise(() => waitFor(() => expect(view.events.isSubscribed()).toBe(true)));

			view.unmount();
			yield* Effect.promise(() => waitFor(() => expect(view.events.isSubscribed()).toBe(false)));
			act(() => view.events.send());
			yield* Effect.promise(() => Promise.resolve());

			expect(loads).toBe(0);
			yield* Effect.promise(() => view.runtime.dispose());
		}),
	);

	it.live("interrupts an in-flight event refresh when the provider unmounts", () =>
		Effect.gen(function* () {
			const started = Deferred.makeUnsafe<void>();
			const cancelled = Deferred.makeUnsafe<void>();
			const view = makeView(() =>
				Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
					Deferred.succeed(cancelled, undefined),
				).pipe(Effect.andThen(Effect.never), Effect.scoped),
			);
			yield* Effect.promise(() => waitFor(() => expect(view.events.isSubscribed()).toBe(true)));

			act(() => view.events.send());
			yield* Deferred.await(started);
			view.removeProvider();

			yield* Deferred.await(cancelled);
			yield* Effect.promise(() => waitFor(() => expect(view.events.isSubscribed()).toBe(false)));
			yield* Effect.promise(() => view.runtime.dispose());
		}),
	);

	it("requires consumers to be inside the provider", () => {
		expect(() => render(<CatalogConsumer name="outside" />)).toThrow(
			"usePluginCatalog must be used within PluginCatalogProvider",
		);
	});
});
