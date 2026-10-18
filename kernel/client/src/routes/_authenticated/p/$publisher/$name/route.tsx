import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";

import { useCollectionScreens } from "#/modules/collections/screens";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { useClearClientPageDocument, useClientPageDocument } from "#/modules/pages/documents/state";
import type { ClientPagePreparation } from "#/modules/pages/preparation/prepare";
import { effectiveCatalogPlugin } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { EntityPickerModal } from "#/modules/provider-add/modal";
import { useEntityPickerSession } from "#/modules/provider-add/picker-session";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/p/$publisher/$name")({
	component: Outlet,
	notFoundComponent: PluginNotFound,
	errorComponent: () => <PluginNotice title="Plugin page unavailable" />,
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
		return <PluginNotice title="Plugin page not found" />;
	}
	const installation = effectiveCatalogPlugin(catalog, packageId);
	return <PluginDocument prepared={preparation.prepared} title={installation?.name ?? "Plugin"} />;
}

function PluginNotice(props: { readonly title: string }) {
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

function PluginDocument(props: { readonly title: string; readonly prepared: PreparedClientPage }) {
	const navigate = useNavigate();
	const { open, session } = useEntityPickerSession();
	const collections = useCollectionScreens();
	useClientPageDocument({
		...props,
		onPickEntity: open,
		inert: session !== null || collections.open,
		onEditCollection: collections.onEditCollection,
		onAddToCollection: collections.onAddToCollection,
	});
	return (
		<>
			{session === null ? null : (
				<EntityPickerModal
					onComplete={session.complete}
					schema={session.request.schema}
					library={session.request.library}
					initialQuery={session.request.initialQuery}
					onCreate={(href) => void navigate({ href })}
					onClose={() => session.complete({ kind: "cancelled" })}
				/>
			)}
			{collections.screen}
		</>
	);
}
