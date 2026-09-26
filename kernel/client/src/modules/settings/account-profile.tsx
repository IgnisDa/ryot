import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";

import type { SettledAuthSession } from "#/modules/auth/service";
import { Avatar } from "#/modules/navigation/avatar";
import { SettingsSection } from "#/modules/settings/settings-section";

type AccountProfileProps = {
	readonly identity: SettledAuthSession | undefined;
	readonly isLoading: boolean;
	readonly isGenerating: boolean;
	readonly generationFailed: boolean;
	readonly onRetry: () => void;
	readonly onGenerateAvatar: () => void;
};

export function AccountProfile(props: AccountProfileProps) {
	if (props.identity === undefined) {
		return (
			<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
				{props.isLoading ? (
					<StatusMessage tone="pending">Loading your account...</StatusMessage>
				) : (
					<div className="flex flex-col items-start gap-3">
						<StatusMessage tone="error">Could not load your account.</StatusMessage>
						<Button type="button" variant="secondary" onClick={props.onRetry}>
							Try again
						</Button>
					</div>
				)}
			</SettingsSection>
		);
	}

	if (props.identity.status !== "authenticated") {
		return null;
	}
	const user = props.identity.user;

	return (
		<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="flex min-w-0 items-center gap-3 sm:flex-1">
						<Avatar name={user.name} image={user.image} className="size-16 text-base" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-base font-semibold text-text">{user.name}</p>
							<p className="truncate text-sm text-text-muted">{user.email}</p>
							<p className="truncate text-xs text-text-subtle">ID: {user.id}</p>
						</div>
					</div>
					<Button
						type="button"
						variant="secondary"
						disabled={props.isGenerating}
						onClick={props.onGenerateAvatar}
						className="flex items-center justify-center gap-2 self-start sm:self-auto"
					>
						<AppIcon size={15} name="rotate-ccw" className="text-text-muted" />
						{props.isGenerating ? "Generating..." : "New avatar"}
					</Button>
				</div>
				{props.generationFailed && (
					<StatusMessage tone="error" className="text-xs">
						Could not generate a new avatar. Try again.
					</StatusMessage>
				)}
			</div>
		</SettingsSection>
	);
}
