import { useRyotQuery } from "@ryot/client-sdk/react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { Effect, Fiber } from "effect";
import { useEffect, useEffectEvent, useMemo } from "react";

import { pluginCatalogQuery } from "#/modules/plugins/catalog";
import { PluginCatalogEventsService } from "#/modules/plugins/events";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginHost } from "#/modules/plugins/plugin-host";
import { toPluginLocation } from "#/modules/plugins/plugin-location";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { resolveRouteTarget } from "#/modules/plugins/route-resolver";
import { Route as AuthenticatedRoute } from "#/routes/_authenticated";

export const Route = createFileRoute("/_authenticated/$pluginSlug")({
	shouldReload: false,
	component: PluginDestination,
	notFoundComponent: PluginNotFound,
});

function PluginDestination() {
	const navigate = useNavigate();
	const { pluginSlug } = Route.useParams();
	const { pathname, searchStr } = useLocation();
	const initial = AuthenticatedRoute.useLoaderData();
	const { runtime, scope, server, theme } = Route.useRouteContext();
	const { serverUrl, userId } = scope;
	const catalogInput = useMemo(
		() => ({ runtime, initialData: initial.catalog }),
		[initial.catalog, runtime],
	);
	const { data: catalog = initial.catalog, refetch } = useRyotQuery(
		pluginCatalogQuery,
		catalogInput,
	);
	const refreshCatalog = useEffectEvent(refetch);
	useEffect(() => {
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe({ serverUrl, userId }, refreshCatalog),
			),
		);
		return () => {
			Effect.runFork(Fiber.interrupt(subscription));
		};
	}, [runtime, serverUrl, userId]);
	const target = resolveRouteTarget(catalog, pluginSlug);
	if (target.owner === "kernel") {
		return <PluginNotFound />;
	}
	const installation = target.installation;

	return (
		<PluginHost
			theme={theme}
			server={server}
			installation={installation}
			onStaleSession={refreshCatalog}
			location={toPluginLocation(pluginSlug, pathname, searchStr)}
			onNavigate={(request) => {
				void navigate({ href: request.href, replace: request.replace });
			}}
			onQuery={(request, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginQueriesService, (service) => service.query({ scope, request })),
					{ signal },
				)
			}
			onInvokeOperation={(request, sourceHash, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginOperationsService, (service) =>
						service.invoke({ scope, request, sourceHash, pluginSlug: installation.slug }),
					),
					{ signal },
				)
			}
		/>
	);
}

function PluginNotFound() {
	return <PluginRouteNotice title="Not found" message="This page does not exist." />;
}

function PluginRouteNotice(props: { readonly title: string; readonly message: string }) {
	return (
		<main className="ui-page">
			<section
				aria-labelledby="plugin-route-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="plugin-route-title" className="ui-heading">
						{props.title}
					</h1>
					<p role="status" className="ui-subtitle">
						{props.message}
					</p>
				</div>
			</section>
		</main>
	);
}
