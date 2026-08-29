import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { useState, useSyncExternalStore } from "react";

import type { AuthSessionStore } from "#/modules/auth/service";
import { AppIcon } from "#/modules/navigation/app-icon";
import { Avatar } from "#/modules/navigation/avatar";
import { SettingsSection } from "#/modules/settings/settings-section";

type AccountProfileProps = {
	readonly session: AuthSessionStore;
	readonly onGenerateAvatar: () => Promise<void>;
};

export function AccountProfile(props: AccountProfileProps) {
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const snapshot = useSyncExternalStore(
		props.session.subscribe,
		props.session.getSnapshot,
		props.session.getSnapshot,
	);

	async function generateAvatar() {
		setPending(true);
		setFailed(false);
		const generated = await props.onGenerateAvatar().then(
			() => true,
			() => false,
		);
		setFailed(!generated);
		setPending(false);
	}

	if (snapshot.status !== "authenticated") {
		return null;
	}

	return (
		<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="flex min-w-0 items-center gap-3 sm:flex-1">
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
					<Button
						type="button"
						disabled={pending}
						variant="secondary"
						onClick={() => void generateAvatar()}
						className="flex items-center justify-center gap-2 self-start sm:self-auto"
					>
						<AppIcon size={15} name="rotate-ccw" className="text-text-muted" />
						{pending ? "Generating..." : "New avatar"}
					</Button>
				</div>
				{failed && (
					<StatusMessage tone="error" className="text-xs">
						Could not generate a new avatar. Try again.
					</StatusMessage>
				)}
			</div>
		</SettingsSection>
	);
}
