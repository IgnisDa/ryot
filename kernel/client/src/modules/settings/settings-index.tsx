import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { resolveSettingsWorkspace } from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { SettingsSectionNav } from "#/modules/settings/section-nav";
import { SettingsFrame } from "#/modules/settings/settings-frame";

const authenticatedRoute = getRouteApi("/_authenticated");

export function SettingsIndex() {
	const navigate = useNavigate();
	const { catalog } = usePluginCatalog();
	const { rememberedSlug } = authenticatedRoute.useLoaderData();
	const workspace = resolveSettingsWorkspace(catalog, rememberedSlug);
	const backFallbackHref = workspace === null ? "/" : `/${workspace.slug}`;

	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			return undefined;
		}
		const desktop = window.matchMedia("(min-width: 768px)");
		const redirectOnDesktop = () => {
			if (desktop.matches) {
				void navigate({ to: "/settings/preferences", replace: true });
			}
		};
		redirectOnDesktop();
		desktop.addEventListener("change", redirectOnDesktop);
		return () => desktop.removeEventListener("change", redirectOnDesktop);
	}, [navigate]);

	return (
		<SettingsFrame title="Settings" backFallbackHref={backFallbackHref}>
			<div
				data-testid="settings-index-sections"
				className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-surface p-2"
			>
				<SettingsSectionNav
					active={null}
					showDisclosure
					onSelect={(section) => navigate({ href: section.path })}
				/>
			</div>
		</SettingsFrame>
	);
}
