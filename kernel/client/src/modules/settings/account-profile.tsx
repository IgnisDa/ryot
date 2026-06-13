import { useSyncExternalStore } from "react";

import type { ServerOrigin } from "#/api/origin";
import type { AuthSessionStore } from "#/modules/auth/client";
import { Avatar } from "#/modules/navigation/avatar";
import { SettingsSection } from "#/modules/settings/settings-section";

type AccountProfileProps = {
	readonly server: ServerOrigin;
	readonly session: AuthSessionStore;
};

export function AccountProfile(props: AccountProfileProps) {
	const snapshot = useSyncExternalStore(
		props.session.subscribe,
		props.session.getSnapshot,
		props.session.getSnapshot,
	);
	if (snapshot.status !== "authenticated") {
		return null;
	}

	return (
		<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<div className="flex items-center gap-3">
					<Avatar
						name={snapshot.user.name}
						image={snapshot.user.image}
						className="size-16 text-base"
					/>
					<div className="min-w-0 flex-1">
						<p className="truncate text-base font-semibold text-text">{snapshot.user.name}</p>
						<p className="truncate text-sm text-text-muted">{snapshot.user.email}</p>
						<p className="truncate text-xs text-text-subtle">ID: {snapshot.user.id}</p>
					</div>
				</div>
				<p className="text-xs text-text-subtle">Server: {props.server}</p>
			</div>
		</SettingsSection>
	);
}
