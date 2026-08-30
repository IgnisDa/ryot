import { RyotProvider } from "@ryot-app/client-sdk/react";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime } from "effect";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { PluginCatalogProvider, usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		icon: "puzzle",
		name: "Fixture",
		slug: "fixture",
		health: "ready",
		isDisabled: false,
		clientApiVersion: 1,
		pluginId: "plugin-1",
		homeSavedViewId: null,
		sourceHash: "source-hash",
		installationId: "installation-1",
	},
];
const ryot = createTestRyotClock();

function CatalogConsumer(props: { readonly name: string }) {
	const { catalog: current, refetch, invalidationRevision } = usePluginCatalog();
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
		<RyotProvider runtime={ryot.runtime} hostServices={{ runtime, scope }}>
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
	it("hydrates without a duplicate load and publishes event refreshes", async () => {
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
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));
		expect(loads).toBe(0);

		current = [{ ...catalog[0], sourceHash: "updated-source-hash" }];
		act(() => view.events.send());

		await screen.findByText("catalog:updated-source-hash");
		expect(loads).toBe(1);
		expect(screen.getByText("catalog-revision:1")).toBeTruthy();
		expect(view.events.getSubscriptionCount()).toBe(1);
		view.unmount();
		await view.runtime.dispose();
	});

	it("keeps one subscription across child rerenders and multiple consumers", async () => {
		const view = makeView(
			() => Effect.die("not used"),
			<>
				<CatalogConsumer name="first" />
				<CatalogConsumer name="second" />
			</>,
		);

		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));
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
		await view.runtime.dispose();
	});

	it("interrupts the subscription and prevents refreshes after unmount", async () => {
		let loads = 0;
		const view = makeView(() =>
			Effect.sync(() => {
				loads += 1;
				return catalog;
			}),
		);
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));

		view.unmount();
		await waitFor(() => expect(view.events.isSubscribed()).toBe(false));
		act(() => view.events.send());
		await Promise.resolve();

		expect(loads).toBe(0);
		await view.runtime.dispose();
	});

	it("interrupts an in-flight event refresh when the provider unmounts", async () => {
		const started = Effect.runSync(Deferred.make<void>());
		const cancelled = Effect.runSync(Deferred.make<void>());
		const view = makeView(() =>
			Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
				Deferred.succeed(cancelled, undefined),
			).pipe(Effect.andThen(Effect.never), Effect.scoped),
		);
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));

		act(() => view.events.send());
		await Effect.runPromise(Deferred.await(started));
		view.removeProvider();

		await Effect.runPromise(Deferred.await(cancelled));
		await waitFor(() => expect(view.events.isSubscribed()).toBe(false));
		await view.runtime.dispose();
	});

	it("requires consumers to be inside the provider", () => {
		expect(() => render(<CatalogConsumer name="outside" />)).toThrow(
			"usePluginCatalog must be used within PluginCatalogProvider",
		);
	});
});
