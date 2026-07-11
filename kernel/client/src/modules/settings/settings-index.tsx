import { useNavigate } from "@tanstack/react-router";

import { useRememberedWorkspaceSlug } from "#/modules/navigation/authenticated-shell";
import { useDesktopEffect } from "#/modules/navigation/breakpoint";
import { resolveRememberedWorkspace } from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { SettingsSectionNav } from "#/modules/settings/section-nav";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export function SettingsIndex() {
	const navigate = useNavigate();
	const { catalog } = usePluginCatalog();
	const rememberedSlug = useRememberedWorkspaceSlug();
	const workspace = resolveRememberedWorkspace(catalog, rememberedSlug);
	const backFallbackHref = workspace === null ? "/" : `/${workspace.slug}`;

	useDesktopEffect(() => void navigate({ to: "/settings/preferences", replace: true }));

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
