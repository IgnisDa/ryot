import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/administration")({
	component: AdministrationRoute,
});

function AdministrationRoute() {
	return (
		<SettingsFrame title="Administration" backFallbackHref="/settings">
			<SettingsSection
				title="Server administration"
				detail="Manage server-wide data and operations."
			>
				<Link
					to="/god-mode"
					className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
				>
					<span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
						<AppIcon size={20} name="crown" />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block font-semibold text-text">God Mode</span>
						<span className="block text-sm text-text-muted">
							Requires an admin access token. The token stays in memory on this device.
						</span>
					</span>
					<AppIcon name="chevron-right" className="shrink-0 text-text-subtle" />
				</Link>
			</SettingsSection>
		</SettingsFrame>
	);
}
