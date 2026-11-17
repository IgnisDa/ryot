import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createFileRoute, Outlet } from "@tanstack/react-router";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { ClientPage } from "#/modules/pages/documents/page";
import { useClearClientPageDocument } from "#/modules/pages/documents/state";
import type { ClientPagePreparation } from "#/modules/pages/preparation/prepare";
import { effectiveCatalogPlugin } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/p/$publisher/$name")({
	component: Outlet,
	notFoundComponent: PluginNotFound,
	errorComponent: () => (
		<PluginNotice title={kernelMessage("client.route.plugin.page-unavailable")} />
	),
});

export function PluginRoutePage({
	packageId,
	preparation,
}: {
	readonly packageId: PluginPackageId;
	readonly preparation: ClientPagePreparation;
}) {
	const t = useT();
	const { catalog } = usePluginCatalog();
	if (preparation.kind === "unavailable") {
		return <PluginNotice title={kernelMessage("client.route.plugin.page-not-found")} />;
	}
	const installation = effectiveCatalogPlugin(catalog, packageId);
	return (
		<ClientPage
			prepared={preparation.prepared}
			title={
				installation === undefined
					? t(kernelMessage("client.route.plugin.fallback-title"))
					: t(installation.name)
			}
		/>
	);
}

function PluginNotice(props: { readonly title: Message }) {
	const t = useT();
	useClearClientPageDocument();
	return <AppScreen title={t(props.title)}>{null}</AppScreen>;
}

function PluginNotFound() {
	const t = useT();
	useClearClientPageDocument();
	usePageTitle(t(kernelMessage("client.route.plugin.not-found")));
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="plugin-route-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="plugin-route-title">
						{t(kernelMessage("client.route.plugin.not-found"))}
					</h1>
					<p role="status" className="ui-subtitle">
						{t(kernelMessage("client.route.page-not-found.detail"))}
					</p>
				</div>
			</section>
		</main>
	);
}
