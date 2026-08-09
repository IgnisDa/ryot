import type { ServerOrigin } from "#/api/origin";
import { SettingsSection } from "#/modules/settings/settings-section";

export function AccountServer(props: { readonly server: ServerOrigin }) {
	return (
		<SettingsSection title="Server" detail="The Ryot server this device is connected to.">
			<div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
				<p className="truncate text-sm font-medium text-text">{props.server}</p>
				<p className="text-xs leading-4 text-text-muted">
					Sign out to connect this device to a different server.
				</p>
			</div>
		</SettingsSection>
	);
}
