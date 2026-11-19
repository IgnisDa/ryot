import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";

import { SettingsSection } from "#/modules/settings/settings-section";
import { versionUrl } from "#/modules/settings/version-url";

type AboutVersionsProps = {
	readonly isLoading: boolean;
	readonly onRetry: () => void;
	readonly serverVersion: string | undefined;
};

export function AboutVersions(props: AboutVersionsProps) {
	const t = useT();
	return (
		<SettingsSection
			title={t(kernelMessage("client.settings.about.version.title"))}
			detail={t(kernelMessage("client.settings.about.version.detail"))}
		>
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<VersionRow
					version={import.meta.env.RYOT_VERSION}
					label={t(kernelMessage("client.settings.about.version.client"))}
				/>
				<ServerVersion {...props} />
			</div>
		</SettingsSection>
	);
}

function VersionRow(props: { readonly label: string; readonly version: string }) {
	const url = versionUrl(props.version);
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="text-sm text-text-muted">{props.label}</span>
			{url === undefined ? (
				<span className="truncate font-mono text-sm text-text">{props.version}</span>
			) : (
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className="truncate font-mono text-sm text-accent-text hover:underline"
				>
					{props.version}
				</a>
			)}
		</div>
	);
}

function ServerVersion(props: AboutVersionsProps) {
	const t = useT();
	if (props.serverVersion !== undefined) {
		return (
			<VersionRow
				version={props.serverVersion}
				label={t(kernelMessage("client.settings.about.version.server"))}
			/>
		);
	}
	if (props.isLoading) {
		return (
			<StatusMessage tone="pending">
				{t(kernelMessage("client.settings.about.version.loading"))}
			</StatusMessage>
		);
	}
	return (
		<div className="flex flex-col items-start gap-3">
			<StatusMessage tone="error">
				{t(kernelMessage("client.settings.about.version.load-failed"))}
			</StatusMessage>
			<Button type="button" variant="secondary" onClick={props.onRetry}>
				{t(kernelMessage("common.action.try-again"))}
			</Button>
		</div>
	);
}
