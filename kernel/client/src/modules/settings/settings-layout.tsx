import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SettingsSectionNav } from "#/modules/settings/section-nav";
import { activeSettingsSection } from "#/modules/settings/sections";

export function SettingsLayout(props: { readonly children: ReactNode }) {
	const navigate = useNavigate();
	const { pathname } = useLocation();

	return (
		<div className="flex h-full min-h-0">
			<aside
				data-testid="settings-sidebar"
				className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-8 md:flex"
			>
				<h2 className="mb-6 px-3 font-display text-2xl font-semibold text-text">Settings</h2>
				<nav aria-label="Settings sections">
					<SettingsSectionNav
						showDisclosure={false}
						active={activeSettingsSection(pathname)}
						onSelect={(section) => navigate({ replace: true, href: section.path })}
					/>
				</nav>
			</aside>
			<div className="min-w-0 flex-1 overflow-y-auto">{props.children}</div>
		</div>
	);
}
