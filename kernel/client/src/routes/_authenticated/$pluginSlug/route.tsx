import type { PluginBridgeProviderSearchScreen } from "@ryot-app/client-plugin-contract";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";

import {
	useClearClientPageDocument,
	useClientPageDocument,
	useHasPublishedClientPageDocument,
} from "#/modules/client-pages/document";
import type { ClientPagePreparation } from "#/modules/client-pages/preparation";
import { AppScreen } from "#/modules/navigation/app-screen";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { ProviderAddModal } from "#/modules/provider-add/modal";

export const Route = createFileRoute("/_authenticated/$pluginSlug")({
	component: Outlet,
	pendingComponent: PluginPending,
	notFoundComponent: PluginNotFound,
	errorComponent: () => <PluginNotice clear title="Plugin page unavailable" />,
});

export function PluginRoutePage({
	pluginSlug,
	preparation,
}: {
	readonly preparation: ClientPagePreparation;
	readonly pluginSlug: string;
}) {
	const { catalog } = usePluginCatalog();
	if (preparation.kind === "unavailable") {
		return <PluginNotice clear title="Plugin page not found" />;
	}
	const installation = catalog.find((candidate) => candidate.slug === pluginSlug);
	return <PluginDocument prepared={preparation.prepared} title={installation?.name ?? "Plugin"} />;
}

function PluginDocument(props: { readonly title: string; readonly prepared: PreparedClientPage }) {
	const [providerSearch, setProviderSearch] = useState<PluginBridgeProviderSearchScreen | null>(
		null,
	);
	useClientPageDocument({
		...props,
		inert: providerSearch !== null,
		onProviderSearch: setProviderSearch,
	});
	return providerSearch === null ? null : (
		<ProviderAddModal
			onClose={() => setProviderSearch(null)}
			initialQuery={providerSearch.initialQuery}
			ownerPluginId={providerSearch.ownerPluginId}
			entitySchemaSlug={providerSearch.entitySchemaSlug}
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
