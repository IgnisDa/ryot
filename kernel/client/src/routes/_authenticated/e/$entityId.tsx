import { createFileRoute } from "@tanstack/react-router";
import { Effect, Match } from "effect";

import { EntitiesService } from "#/modules/entities/service";
import { AppScreen } from "#/modules/navigation/app-screen";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { resolveEntityRouteTarget } from "#/modules/plugins/route-resolver";

export const Route = createFileRoute("/_authenticated/e/$entityId")({
	component: EntityPage,
	errorComponent: EntityError,
	pendingComponent: EntityPending,
	loader: async ({ abortController, context, params }) => {
		const provenance = await context.runtime.runPromise(
			Effect.flatMap(EntitiesService, (service) =>
				service.loadRouteProvenance(context.ryot, params.entityId),
			),
			{ signal: abortController.signal },
		);
		return { provenance };
	},
});

function EntityPage() {
	const { entityId } = Route.useParams();
	const { provenance } = Route.useLoaderData();
	const { catalog } = usePluginCatalog();
	const target = resolveEntityRouteTarget(catalog, entityId, provenance);
	return Match.value(target).pipe(
		Match.when({ kind: "plugin" }, () => null),
		Match.when({ kind: "missing" }, () => <EntityNotice title="Entity not found" />),
		Match.when({ kind: "unsupported" }, () => (
			<EntityNotice title="Kernel-owned entity unsupported" />
		)),
		Match.when({ kind: "installation-missing" }, () => (
			<EntityNotice title="Required plugin unavailable" />
		)),
		Match.exhaustive,
	);
}

function EntityPending() {
	return <EntityNotice title="Entity loading" />;
}

function EntityError() {
	return <EntityNotice title="Retryable entity load failure" />;
}

function EntityNotice(props: { readonly title: string }) {
	return <AppScreen title={props.title}>{null}</AppScreen>;
}
