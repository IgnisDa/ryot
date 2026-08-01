import { createFileRoute, notFound, useLocation, useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";

import { protectedRouteGuard } from "../modules/auth/route-gates";
import { PluginCatalogService } from "../modules/plugins/catalog";
import { PluginOperationsService } from "../modules/plugins/operations";
import { PluginHost } from "../modules/plugins/plugin-host";
import { toPluginLocation } from "../modules/plugins/plugin-location";
import { resolveRouteTarget } from "../modules/plugins/route-resolver";

export const Route = createFileRoute("/$pluginSlug")({
	shouldReload: false,
	component: PluginDestination,
	errorComponent: PluginLoadError,
	notFoundComponent: PluginNotFound,
	beforeLoad: ({ context, location }) => protectedRouteGuard(context, location.href),
	loader: async ({ context, params }) => {
		const catalog = await context.runtime.runPromise(
			Effect.flatMap(PluginCatalogService, (service) => service.load(context.scope)),
		);
		const target = resolveRouteTarget(catalog, params.pluginSlug);
		if (target.owner === "kernel") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		return { installation: target.installation };
	},
});

function PluginDestination() {
	const navigate = useNavigate();
	const { pluginSlug } = Route.useParams();
	const { pathname, searchStr } = useLocation();
	const { installation } = Route.useLoaderData();
	const { runtime, scope, server } = Route.useRouteContext();

	return (
		<PluginHost
			server={server}
			installation={installation}
			location={toPluginLocation(pluginSlug, pathname, searchStr)}
			onNavigate={(request) => {
				void navigate({ href: request.href, replace: request.replace });
			}}
			onInvokeOperation={(request, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginOperationsService, (service) =>
						service.invoke({ scope, request, pluginSlug: installation.slug }),
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
