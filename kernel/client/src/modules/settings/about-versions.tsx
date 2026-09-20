import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";

import { SettingsSection } from "#/modules/settings/settings-section";
import { versionUrl } from "#/modules/settings/version-url";

type AboutVersionsProps = {
	readonly serverVersion: string | undefined;
	readonly isLoading: boolean;
	readonly onRetry: () => void;
};

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
	if (props.serverVersion !== undefined) {
		return <VersionRow label="Server" version={props.serverVersion} />;
	}
	if (props.isLoading) {
		return <StatusMessage tone="pending">Loading server version...</StatusMessage>;
	}
	return (
		<div className="flex flex-col items-start gap-3">
			<StatusMessage tone="error">Could not load the server version.</StatusMessage>
			<Button type="button" variant="secondary" onClick={props.onRetry}>
				Try again
			</Button>
		</div>
	);
}

export function AboutVersions(props: AboutVersionsProps) {
	return (
		<SettingsSection title="Version" detail="The builds of this app and its server.">
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<VersionRow label="Client" version={import.meta.env.RYOT_VERSION} />
				<ServerVersion {...props} />
			</div>
		</SettingsSection>
	);
}
