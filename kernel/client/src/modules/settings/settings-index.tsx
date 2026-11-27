import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useNavigate } from "@tanstack/react-router";

import { resolveRememberedWorkspace } from "#/modules/navigation/workspace-state";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { SettingsSectionNav } from "#/modules/settings/section-nav";
import { settingsGroups } from "#/modules/settings/sections";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { useRememberedWorkspacePluginId } from "#/modules/shell/authenticated-shell-context";
import { useDesktopEffect } from "#/modules/shell/breakpoint";

export function SettingsIndex() {
	const t = useT();
	const navigate = useNavigate();
	const { catalog } = usePluginCatalog();
	const rememberedPluginId = useRememberedWorkspacePluginId();
	const workspace = resolveRememberedWorkspace(catalog, rememberedPluginId);
	const backFallbackHref = workspace === null ? "/" : pluginPath(workspace.packageId);

	useDesktopEffect(
		() => void navigate({ replace: true, href: settingsGroups[0].sections[0].path }),
	);

	return (
		<SettingsFrame
			backFallbackHref={backFallbackHref}
			title={t(kernelMessage("client.settings.title"))}
		>
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
