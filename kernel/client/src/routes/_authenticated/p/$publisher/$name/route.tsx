import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import {
	useClearClientPageDocument,
	useClientPageDocument,
	useHasPublishedClientPageDocument,
} from "#/modules/pages/documents/state";
import type { ClientPagePreparation } from "#/modules/pages/preparation/prepare";
import { effectiveCatalogPlugin } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { ProviderAddModal } from "#/modules/provider-add/modal";
import { useProviderSearchSession } from "#/modules/provider-add/search-session";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/p/$publisher/$name")({
	component: Outlet,
	pendingComponent: PluginPending,
	notFoundComponent: PluginNotFound,
	errorComponent: () => <PluginNotice clear title="Plugin page unavailable" />,
});

export function PluginRoutePage({
	packageId,
	preparation,
}: {
	readonly packageId: PluginPackageId;
	readonly preparation: ClientPagePreparation;
}) {
	const { catalog } = usePluginCatalog();
	if (preparation.kind === "unavailable") {
		return <PluginNotice clear title="Plugin page not found" />;
	}
	const installation = effectiveCatalogPlugin(catalog, packageId);
	return <PluginDocument prepared={preparation.prepared} title={installation?.name ?? "Plugin"} />;
}

function PluginDocument(props: { readonly title: string; readonly prepared: PreparedClientPage }) {
	const navigate = useNavigate();
	const { open, session } = useProviderSearchSession();
	useClientPageDocument({ ...props, onProviderSearch: open, inert: session !== null });
	return session === null ? null : (
		<ProviderAddModal
			onComplete={session.complete}
			schema={session.request.schema}
			library={session.request.library}
			initialQuery={session.request.initialQuery}
			onCreate={(href) => void navigate({ href })}
			onClose={() => session.complete({ kind: "cancelled" })}
		/>
	);
}

function PluginPending() {
	return useHasPublishedClientPageDocument() ? null : <PluginNotice title="Plugin loading" />;
}

function PluginNotice(props: { readonly title: string; readonly clear?: boolean }) {
	if (props.clear) {
		return <ClearedPluginNotice title={props.title} />;
	}
	return <AppScreen title={props.title}>{null}</AppScreen>;
}

function ClearedPluginNotice(props: { readonly title: string }) {
	useClearClientPageDocument();
	return <AppScreen title={props.title}>{null}</AppScreen>;
}

function PluginNotFound() {
	useClearClientPageDocument();
	usePageTitle("Plugin not found");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="plugin-route-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="plugin-route-title">
						Plugin not found
					</h1>
					<p role="status" className="ui-subtitle">
						This page does not exist.
					</p>
				</div>
			</section>
		</main>
	);
}
