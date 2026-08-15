import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ServerOrigin } from "../../api/origin";
import type { ApiScope } from "../../api/scope";
import { decideProtectedRoute, type AuthSessionState } from "../../modules/auth/route-gates";
import { AuthService } from "../../modules/auth/service";
import { PluginCatalogService } from "../../modules/plugins/catalog";
import { PluginHost } from "../../modules/plugins/plugin-host";
import { resolveRouteTarget } from "../../modules/plugins/route-resolver";
import { ServerService } from "../../modules/server/service";

type CatalogState =
	| { readonly status: "loading" }
	| { readonly status: "unavailable" }
	| { readonly status: "ready"; readonly catalog: PluginClientCatalog };

export const Route = createFileRoute("/$pluginSlug/")({
	component: PluginDestination,
	beforeLoad: ({ context, params }) => {
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			return redirect({ to: "/onboarding", search: { redirect: `/${params.pluginSlug}` } });
		}
		return undefined;
	},
});

function PluginDestination() {
	const { runtime } = Route.useRouteContext();
	const server = runtime.runSync(Effect.flatMap(ServerService, (service) => service.selected));
	return server === null ? null : <ConnectedPlugin server={server} />;
}

function ConnectedPlugin(props: { readonly server: ServerOrigin }) {
	const { runtime } = Route.useRouteContext();
	const { pluginSlug } = Route.useParams();
	const navigate = Route.useNavigate();
	const auth = runtime.runSync(AuthService);
	const store = auth.session(props.server);
	const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	let sessionState: AuthSessionState = { status: "missing" };
	if (session.status === "pending") {
		sessionState = { status: "pending" };
	} else if (session.status === "authenticated") {
		sessionState = { status: "authenticated", userId: session.user.id };
	}
	const decision = decideProtectedRoute(props.server, sessionState, `/${pluginSlug}`);

	useEffect(() => {
		if (decision.action === "redirect") {
			void navigate({ replace: true, to: decision.to, search: { redirect: decision.redirectTo } });
		}
	}, [decision, navigate]);

	if (decision.action !== "allow") {
		return <PluginRouteNotice title="Loading plugin" message="Checking your signed-in state..." />;
	}

	return <PluginWorkspace scope={decision.scope} server={props.server} pluginSlug={pluginSlug} />;
}

function PluginWorkspace(props: {
	readonly scope: ApiScope;
	readonly pluginSlug: string;
	readonly server: ServerOrigin;
}) {
	const { runtime } = Route.useRouteContext();
	const [state, setState] = useState<CatalogState>({ status: "loading" });

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		void runtime
			.runPromise(
				Effect.flatMap(PluginCatalogService, (service) => service.load(props.scope)),
				{ signal: controller.signal },
			)
			.then(
				(catalog) => setState({ catalog, status: "ready" }),
				() => {
					if (!controller.signal.aborted) {
						setState({ status: "unavailable" });
					}
				},
			);
		return () => controller.abort();
	}, [props.scope, runtime]);

	if (state.status === "loading") {
		return <PluginRouteNotice title="Loading plugin" message="Preparing this plugin..." />;
	}
	if (state.status === "unavailable") {
		return (
			<PluginRouteNotice title="Plugin unavailable" message="This plugin could not be loaded." />
		);
	}

	const target = resolveRouteTarget(state.catalog, props.pluginSlug);
	if (target.owner === "kernel") {
		return <PluginRouteNotice title="Not found" message="This page does not exist." />;
	}

	return <PluginHost server={props.server} installation={target.installation} />;
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
