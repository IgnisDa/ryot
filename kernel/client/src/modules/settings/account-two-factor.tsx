import type { TwoFactorStatus } from "@ryot-app/contract/modules/account/schemas";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Link } from "@tanstack/react-router";

import { SettingsSection } from "#/modules/settings/settings-section";

const manageClassName =
	"min-h-11 shrink-0 rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text";

export function AccountTwoFactor(props: {
	readonly isDemo: boolean;
	readonly isLoading: boolean;
	readonly onRetry: () => void;
	readonly status: undefined | TwoFactorStatus;
	readonly onOpenNative: undefined | (() => void);
}) {
	const t = useT();
	if (props.isDemo || props.status?.available === false) {
		return null;
	}

	return (
		<SettingsSection
			title={t(kernelMessage("client.settings.account.two-factor.title"))}
			detail={t(kernelMessage("client.settings.account.two-factor.detail"))}
		>
			<AccountTwoFactorContent {...props} />
		</SettingsSection>
	);
}

function AccountTwoFactorContent(props: Parameters<typeof AccountTwoFactor>[0]) {
	const t = useT();
	if (props.status === undefined) {
		return props.isLoading ? (
			<StatusMessage tone="pending">
				{t(kernelMessage("client.settings.account.two-factor.loading"))}
			</StatusMessage>
		) : (
			<div className="flex flex-col items-start gap-3">
				<StatusMessage tone="error">
					{t(kernelMessage("client.settings.account.two-factor.load-failed"))}
				</StatusMessage>
				<Button type="button" variant="secondary" onClick={props.onRetry}>
					{t(kernelMessage("common.action.try-again"))}
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
				<span className="block font-semibold text-text">
					{t(kernelMessage("client.settings.account.two-factor.authenticator"))}
				</span>
				<span className="block text-sm text-text-muted">
					{t(
						props.status.enabled
							? kernelMessage("client.settings.account.two-factor.on")
							: kernelMessage("client.settings.account.two-factor.off"),
					)}
				</span>
			</span>
			{props.onOpenNative ? (
				<Button type="button" variant="secondary" onClick={props.onOpenNative}>
					{t(kernelMessage("client.settings.account.two-factor.manage"))}
				</Button>
			) : (
				<Link to="/oauth/two-factor" className={manageClassName} search={{ from: "settings" }}>
					{t(kernelMessage("client.settings.account.two-factor.manage"))}
				</Link>
			)}
		</div>
	);
}
