import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, notFound, useLocation, useNavigate } from "@tanstack/react-router";
import { Effect, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { createKernelRyotClient } from "../api/ryot-client";
import { protectedRouteGuard } from "../modules/auth/route-gates";
import { makePluginCatalogAtom, PluginCatalogService } from "../modules/plugins/catalog";
import { PluginOperationsService } from "../modules/plugins/operations";
import { PluginHost } from "../modules/plugins/plugin-host";
import { toPluginLocation } from "../modules/plugins/plugin-location";
import { PluginQueriesService } from "../modules/plugins/queries";
import { resolveRouteTarget } from "../modules/plugins/route-resolver";

export const Route = createFileRoute("/$pluginSlug")({
	shouldReload: false,
	component: PluginDestination,
	errorComponent: PluginLoadError,
	notFoundComponent: PluginNotFound,
	beforeLoad: ({ context, location }) => protectedRouteGuard(context, location.href),
	loader: async ({ context, params }) => {
		const ryot = createKernelRyotClient(context.runtime, context.scope, context.theme);
		const catalog = await context.runtime.runPromise(
			Effect.flatMap(PluginCatalogService, (service) => service.load(ryot)),
		);
		const target = resolveRouteTarget(catalog, params.pluginSlug);
		if (target.owner === "kernel") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		return { ryot, catalog };
	},
});

function PluginDestination() {
	const navigate = useNavigate();
	const initial = Route.useLoaderData();
	const { pluginSlug } = Route.useParams();
	const { pathname, searchStr } = useLocation();
	const { runtime, scope, server, theme } = Route.useRouteContext();
	const catalogAtom = useMemo(
		() => makePluginCatalogAtom(runtime, initial.ryot, initial.catalog),
		[initial.catalog, initial.ryot, runtime],
	);
	const catalogResult = useAtomValue(catalogAtom);
	const catalog = Option.getOrElse(AsyncResult.value(catalogResult), () => initial.catalog);
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

function PluginLoadError() {
	return (
		<PluginRouteNotice title="Plugin unavailable" message="This plugin could not be loaded." />
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
