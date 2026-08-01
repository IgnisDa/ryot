import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { decideProtectedRoute } from "../../modules/auth/route-gates";
import { AuthService, toAuthSessionState } from "../../modules/auth/service";
import { PluginCatalogService } from "../../modules/plugins/catalog";
import { PluginHost } from "../../modules/plugins/plugin-host";
import { resolveRouteTarget } from "../../modules/plugins/route-resolver";
import { ServerService } from "../../modules/server/service";

export const Route = createFileRoute("/$pluginSlug/")({
	component: PluginDestination,
	errorComponent: PluginLoadError,
	notFoundComponent: PluginNotFound,
	beforeLoad: async ({ context, params }) => {
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({
				replace: true,
				to: "/onboarding",
				search: { redirect: `/${params.pluginSlug}` },
			});
		}
		const session = await context.runtime.runPromise(
			Effect.flatMap(AuthService, (service) => service.settledSession(server)),
		);
		const decision = decideProtectedRoute(
			server,
			toAuthSessionState(session),
			`/${params.pluginSlug}`,
		);
		if (decision.action === "redirect") {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: decision.to, search: { redirect: decision.redirectTo } });
		}
		if (decision.action === "wait") {
			throw new Error("Unreachable: settledSession never resolves a pending session.");
		}
		return { server, scope: decision.scope };
	},
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
	const { server } = Route.useRouteContext();
	const { installation } = Route.useLoaderData();
	return <PluginHost server={server} installation={installation} />;
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
