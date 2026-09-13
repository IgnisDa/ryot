import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { TwoFactorStatus } from "@ryot-app/contract/modules/user-settings/schemas";
import { Link } from "@tanstack/react-router";

import { SettingsSection } from "#/modules/settings/settings-section";

const manageClassName =
	"min-h-11 shrink-0 rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text";

export function AccountTwoFactor(props: {
	readonly isDemo: boolean;
	readonly isLoading: boolean;
	readonly status: TwoFactorStatus | undefined;
	readonly onRetry: () => void;
	readonly onOpenNative: (() => void) | undefined;
}) {
	if (props.isDemo || props.status?.available === false) {
		return null;
	}

	return (
		<SettingsSection
			title="Two-factor authentication"
			detail="Require a code from an authenticator app when you sign in with your password."
		>
			<AccountTwoFactorContent {...props} />
		</SettingsSection>
	);
}

function AccountTwoFactorContent(props: Parameters<typeof AccountTwoFactor>[0]) {
	if (props.status === undefined) {
		return props.isLoading ? (
			<StatusMessage tone="pending">Loading two-factor authentication...</StatusMessage>
		) : (
			<div className="flex flex-col items-start gap-3">
				<StatusMessage tone="error">Could not load two-factor authentication.</StatusMessage>
				<Button type="button" variant="secondary" onClick={props.onRetry}>
					Try again
				</Button>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
			<span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
				<AppIcon size={20} name="lock" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block font-semibold text-text">Authenticator app</span>
				<span className="block text-sm text-text-muted">{props.status.enabled ? "On" : "Off"}</span>
			</span>
			{props.onOpenNative ? (
				<Button type="button" variant="secondary" onClick={props.onOpenNative}>
					Manage
				</Button>
			) : (
				<Link to="/oauth/two-factor" className={manageClassName} search={{ from: "settings" }}>
					Manage
				</Link>
			)}
		</div>
	);
}
