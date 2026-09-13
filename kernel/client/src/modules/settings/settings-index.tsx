import { useNavigate } from "@tanstack/react-router";

import { useRememberedWorkspaceSlug } from "#/modules/navigation/authenticated-shell-context";
import { useDesktopEffect } from "#/modules/navigation/breakpoint";
import { resolveRememberedWorkspace } from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { SettingsSectionNav } from "#/modules/settings/section-nav";
import { settingsGroups } from "#/modules/settings/sections";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export function SettingsIndex() {
	const navigate = useNavigate();
	const { catalog } = usePluginCatalog();
	const rememberedSlug = useRememberedWorkspaceSlug();
	const workspace = resolveRememberedWorkspace(catalog, rememberedSlug);
	const backFallbackHref = workspace === null ? "/" : `/${workspace.slug}`;

	useDesktopEffect(
		() => void navigate({ replace: true, href: settingsGroups[0].sections[0].path }),
	);

	return (
		<SettingsFrame title="Settings" backFallbackHref={backFallbackHref}>
			<div data-testid="settings-index-sections">
				<SettingsSectionNav
					active={null}
					variant="index"
					onSelect={(section) => navigate({ href: section.path })}
				/>
			</div>
		</SettingsFrame>
	);
}
