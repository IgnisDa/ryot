import { describe, expect, it } from "@effect/vitest";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import type { RyotSchedule } from "@ryot-app/plugin-client-sdk/schedule";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { StrictMode, useEffect } from "react";

import { decodeServerOrigin } from "#/api/origin";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { createKernelRyotClientStore } from "#/api/ryot-client";
import { KernelRyotProvider } from "#/api/ryot-client-provider";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { pluginBridgeServicesTestLayer } from "#/modules/pages/bridge/services.test-layer";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { makePluginCatalog } from "#/modules/plugins/catalog/service.test-layer";
import { getRouter } from "#/router";
import {
	catalog,
	ClientPageSessionsRouteStubs,
	CustomizeRouteStubs,
	DeviceRouteStubs,
	EntityRouteStubs,
	ImportsRouteStubs,
	InstanceAdminRouteStubs,
	IntegrationRouteStubs,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStubLayer,
	makeUserSettingsStub,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	OAuthRouteStubs,
	PagesApiRouteStubs,
	ProviderAddRouteStubs,
	SavedViewRouteStubs,
	server,
	ServerStub,
	theme,
} from "#/routes/-route-fixtures";

const scope = { userId: "user-1", serverUrl: server };

const makeRuntime = () =>
	ManagedRuntime.make(
		Layer.mergeAll(
			KernelApiTestLayer,
			ClientPageSessionsRouteStubs,
			CustomizeRouteStubs,
			DeviceRouteStubs,
			EntityRouteStubs,
			ImportsRouteStubs,
			InstanceAdminRouteStubs,
			IntegrationRouteStubs,
			makeAuthStub(),
			makePublicApiStub(),
			makeUserSettingsStub(),
			NavigationRouteStubs,
			NotificationChannelRouteStubs,
			PagesApiRouteStubs,
			ProviderAddRouteStubs,
			SavedViewRouteStubs,
			ServerStub,
			makePluginCatalog(catalog),
			makePluginCatalogEventsTestLayer().layer,
			pluginBridgeServicesTestLayer,
		).pipe(Layer.provideMerge(OAuthRouteStubs), Layer.provideMerge(makeStorageStubLayer())),
	);

const makeProbe = () => {
	const starts: Array<{ readonly client: RyotClient; readonly schedule: RyotSchedule }> = [];
	const exits: RyotSchedule[] = [];
	const delayed: RyotSchedule[] = [];
	function Probe() {
		const client = useRyot();
		const schedule = useRyotSchedule();
		useEffect(() => {
			starts.push({ client, schedule });
			schedule.run(
				Effect.sleep(3_600_000).pipe(
					Effect.andThen(Effect.sync(() => delayed.push(schedule))),
					Effect.asVoid,
				),
				() => exits.push(schedule),
			);
		}, [client, schedule]);
		return <div data-testid="runtime-probe" />;
	}
	return { Probe, exits, starts, delayed };
};

describe("committed kernel SDK runtime", () => {
	it.live("leaves an abandoned authenticated preload with client and host values only", () => {
		const runtime = makeRuntime();
		return Effect.gen(function* () {
			const router = getRouter(
				{ theme, runtime, backInterceptors: createBackInterceptors() },
				createMemoryHistory({ initialEntries: ["/auth"] }),
			);
			const matches = yield* Effect.promise(() => router.preloadRoute({ to: "/settings" }));
			const authenticated = matches?.find((match) => match.routeId === "/_authenticated");
			expect(authenticated?.context).toMatchObject({ scope });
			expect(authenticated?.context).not.toHaveProperty("ryotRuntime");
			expect(Object.keys(router.options.context.ryotClients.get(scope)).sort()).toEqual([
				"client",
				"hostServices",
			]);
			expect(screen.queryByTestId("runtime-probe")).toBeNull();
		}).pipe(Effect.ensuring(runtime.disposeEffect));
	});

	it.live("keeps equivalent scopes stable even after another scope was preloaded", () => {
		const runtime = makeRuntime();
		return Effect.gen(function* () {
			const store = createKernelRyotClientStore(runtime, theme);
			const first = store.get(scope);
			const probe = makeProbe();
			const view = render(
				<KernelRyotProvider {...first}>
					<probe.Probe />
				</KernelRyotProvider>,
			);
			const element = yield* Effect.promise(() => screen.findByTestId("runtime-probe"));
			store.get({ ...scope, userId: "user-2" });
			const equivalent = store.get({ ...scope });
			expect(equivalent).not.toBe(first);
			view.rerender(
				<KernelRyotProvider {...equivalent}>
					<probe.Probe />
				</KernelRyotProvider>,
			);
			expect(screen.getByTestId("runtime-probe")).toBe(element);
			expect(probe.starts).toHaveLength(1);
			expect(probe.starts[0]?.client).toBe(first.client);
			expect(probe.exits).toEqual([]);
			view.unmount();
			yield* Effect.promise(() => waitFor(() => expect(probe.exits).toHaveLength(1)));
			expect(probe.delayed).toEqual([]);
		}).pipe(Effect.ensuring(runtime.disposeEffect));
	});

	it.live.each([
		{ ...scope, userId: "user-2" },
		{ ...scope, serverUrl: decodeServerOrigin("https://other.example") },
	])("closes departing scheduled work on replacement with %j and layout removal", (replacement) => {
		const runtime = makeRuntime();
		return Effect.gen(function* () {
			const store = createKernelRyotClientStore(runtime, theme);
			const probe = makeProbe();
			const view = render(
				<KernelRyotProvider {...store.get(scope)}>
					<probe.Probe />
				</KernelRyotProvider>,
			);
			const element = yield* Effect.promise(() => screen.findByTestId("runtime-probe"));
			view.rerender(
				<KernelRyotProvider {...store.get(replacement)}>
					<probe.Probe />
				</KernelRyotProvider>,
			);
			yield* Effect.promise(() => waitFor(() => expect(probe.starts).toHaveLength(2)));
			yield* Effect.promise(() => waitFor(() => expect(probe.exits).toHaveLength(1)));
			expect(screen.getByTestId("runtime-probe")).not.toBe(element);
			expect(probe.exits).toEqual([probe.starts[0]?.schedule]);
			view.rerender(null);
			yield* Effect.promise(() => waitFor(() => expect(probe.exits).toHaveLength(2)));
			expect(probe.exits).toEqual(probe.starts.map((start) => start.schedule));
			expect(probe.delayed).toEqual([]);
		}).pipe(Effect.ensuring(runtime.disposeEffect));
	});

	it.live("closes scheduled work when the application is disposed with the layout mounted", () => {
		const runtime = makeRuntime();
		return Effect.gen(function* () {
			const store = createKernelRyotClientStore(runtime, theme);
			const probe = makeProbe();
			const view = render(
				<KernelRyotProvider {...store.get(scope)}>
					<probe.Probe />
				</KernelRyotProvider>,
			);
			yield* Effect.promise(() => screen.findByTestId("runtime-probe"));
			yield* runtime.disposeEffect;
			expect(probe.exits).toEqual(probe.starts.map((start) => start.schedule));
			expect(probe.delayed).toEqual([]);
			view.unmount();
		}).pipe(Effect.ensuring(runtime.disposeEffect));
	});

	it.live(
		"creates a usable runtime after StrictMode effect replay and releases it on unmount",
		() => {
			const runtime = makeRuntime();
			return Effect.gen(function* () {
				const store = createKernelRyotClientStore(runtime, theme);
				const probe = makeProbe();
				const view = render(
					<StrictMode>
						<KernelRyotProvider {...store.get(scope)}>
							<probe.Probe />
						</KernelRyotProvider>
					</StrictMode>,
				);
				yield* Effect.promise(() => screen.findByTestId("runtime-probe"));
				expect(probe.starts.length).toBeGreaterThan(0);
				expect(probe.exits).toEqual([]);
				view.unmount();
				yield* Effect.promise(() =>
					waitFor(() => expect(probe.exits).toHaveLength(probe.starts.length)),
				);
				expect(probe.delayed).toEqual([]);
			}).pipe(Effect.ensuring(runtime.disposeEffect));
		},
	);
});
