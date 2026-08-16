import { createFileRoute, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useCallback, useEffect } from "react";

import { useEdge, useSetPluginHeaderTitle } from "#/modules/navigation/authenticated-shell";
import { historyEntry } from "#/modules/navigation/history-entry";
import { ArtifactSessions, ArtifactSessionStaleError } from "#/modules/plugins/artifact-sessions";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginHost } from "#/modules/plugins/plugin-host";
import { toPluginLocation } from "#/modules/plugins/plugin-location";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { resolveRouteTarget } from "#/modules/plugins/route-resolver";

export const Route = createFileRoute("/_authenticated/$pluginSlug")({
	shouldReload: false,
	component: PluginDestination,
	notFoundComponent: PluginNotFound,
});

function PluginDestination() {
	const { pluginSlug } = Route.useParams();
	const { catalog, refetch } = usePluginCatalog();
	const target = resolveRouteTarget(catalog, pluginSlug);
	if (target.owner === "kernel") {
		return <PluginNotFound />;
	}
	return <PluginInstallation installation={target.installation} refetch={refetch} />;
}

function PluginInstallation(props: {
	readonly refetch: () => void;
	readonly installation: Parameters<typeof PluginHost>[0]["installation"];
}) {
	const edge = useEdge();
	const router = useRouter();
	const navigate = useNavigate();
	const setHeaderTitle = useSetPluginHeaderTitle();
	const { pluginSlug } = Route.useParams();
	const { pathname, searchStr, state } = useLocation();
	const { runtime, scope, theme } = Route.useRouteContext();
	const { installation, refetch } = props;
	const { serverUrl, userId } = scope;
	const onCreateArtifactSession = useCallback(
		(
			request: {
				readonly sourceHash: string;
				readonly artifactHash: string;
				readonly installationId: string;
			},
			signal: AbortSignal,
		) =>
			runtime.runPromise(
				Effect.flatMap(ArtifactSessions, (service) =>
					service
						.create({
							scope: { serverUrl, userId },
							pluginSlug: installation.slug,
							sourceHash: request.sourceHash,
							installationId: request.installationId,
							clientArtifactHash: request.artifactHash,
						})
						.pipe(
							Effect.tapError((error) =>
								error instanceof ArtifactSessionStaleError ? Effect.sync(refetch) : Effect.void,
							),
						),
				),
				{ signal },
			),
		[installation.slug, refetch, runtime, serverUrl, userId],
	);
	const onRenewArtifactSession = useCallback(
		(sessionId: string, signal: AbortSignal) =>
			runtime.runPromise(
				Effect.flatMap(ArtifactSessions, (service) =>
					service.renew({ scope: { serverUrl, userId }, sessionId }),
				),
				{ signal },
			),
		[runtime, serverUrl, userId],
	);
	const onRevokeArtifactSession = useCallback(
		(sessionId: string) =>
			runtime.runPromise(
				Effect.flatMap(ArtifactSessions, (service) =>
					service.revoke({ scope: { serverUrl, userId }, sessionId }),
				),
			),
		[runtime, serverUrl, userId],
	);

	useEffect(() => () => setHeaderTitle(null), [setHeaderTitle]);

	return (
		<PluginHost
			theme={theme}
			onStaleSession={refetch}
			onHeader={setHeaderTitle}
			installation={installation}
			onRenewArtifactSession={onRenewArtifactSession}
			onCreateArtifactSession={onCreateArtifactSession}
			onRevokeArtifactSession={onRevokeArtifactSession}
			artifactSessionScopeKey={`${serverUrl}\0${userId}`}
			onNavigateBack={() => router.history.back()}
			onNavigate={(request) => {
				void navigate({ href: request.href, replace: request.replace });
			}}
			navigation={{
				...historyEntry(state),
				edgeBack: edge.owner === "plugin" && edge.intent === "back",
				location: toPluginLocation(pluginSlug, pathname, searchStr),
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
