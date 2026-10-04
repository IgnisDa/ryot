import { Button, Modal } from "@ryot-app/client-ui-sdk";
import { useState } from "react";

import type { ManagedPluginInstallation, PluginManagementAction } from "./management";

const label = (installation: ManagedPluginInstallation) =>
	`${installation.name} · ${installation.scope === "system" ? "System" : "Private"} · ${installation.packageId}`;

function InstallationDetails(props: {
	readonly installation: ManagedPluginInstallation;
	readonly pending: boolean;
	readonly onAction: (action: PluginManagementAction) => void;
}) {
	const installation = props.installation;
	const [config, setConfig] = useState(JSON.stringify(installation.config, null, 2));
	const [unsetKeys, setUnsetKeys] = useState("");
	const [file, setFile] = useState<File>();
	const [confirmRemoval, setConfirmRemoval] = useState(false);
	return (
		<>
			<dl className="grid gap-2 text-sm">
				{[
					["Health", installation.health],
					["Plugin ID", installation.pluginId],
					["Package ID", installation.packageId],
					["Source hash", installation.sourceHash],
					["Installation ID", installation.installationId],
					["Active revision ID", installation.activeRevisionId],
					["Hidden intent", installation.isHidden ? "Hidden" : "Shown"],
					["Incompatibility reason", installation.incompatibilityReason ?? "None"],
					["Initialization", installation.isInitialized ? "Completed" : "Not completed"],
				].map(([name, value]) => (
					<div key={name}>
						<dt className="font-medium">{name}</dt>
						<dd className="break-all">{value}</dd>
					</div>
				))}
			</dl>
			{installation.healthReason === null ? null : <p role="status">{installation.healthReason}</p>}
			{installation.incompatibilityReason === "package-identity-conflict" ? (
				<p role="status">
					This private package is quarantined. Its data and exact references remain private.
					Re-enabling validates the retained package; it does not select the system copy.
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="secondary"
					disabled={props.pending}
					onClick={() => props.onAction({ installation, kind: "state", isHidden: true })}
				>
					Hide
				</Button>
				<Button
					disabled={props.pending}
					onClick={() => props.onAction({ installation, kind: "state", isHidden: false })}
				>
					{installation.health === "ready" ? "Show" : "Re-enable"}
				</Button>
				<a href="/settings/backups" className="text-accent-text underline">
					Back up retained data
				</a>
				<a
					className="text-accent-text underline"
					href={`/settings/plugin-preferences/${encodeURIComponent(installation.installationId)}`}
				>
					User preferences
				</a>
			</div>
			{installation.scope === "user" ? (
				<>
					<form
						className="grid gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							props.onAction({ config, unsetKeys, installation, kind: "configure" });
						}}
					>
						<label className="grid gap-1">
							Configuration JSON
							<textarea
								value={config}
								onChange={(event) => setConfig(event.currentTarget.value)}
								className="min-h-32 rounded border border-border bg-bg p-2"
							/>
						</label>
						<label className="grid gap-1">
							Unset configuration keys (comma separated)
							<input
								value={unsetKeys}
								className="rounded border border-border bg-bg p-2"
								onChange={(event) => setUnsetKeys(event.currentTarget.value)}
							/>
						</label>
						<p className="text-sm text-text-muted">
							Configured secrets:{" "}
							{installation.configuredSecrets.length === 0
								? "None"
								: installation.configuredSecrets.join(", ")}
							. Existing secret values are not shown; omit a key to preserve it.
						</p>
						<Button type="submit" disabled={props.pending}>
							Save configuration
						</Button>
					</form>
					<form
						className="grid gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (file) {
								props.onAction({ file, installation, kind: "package" });
							}
						}}
					>
						<label className="grid gap-1">
							Replacement plugin archive
							<input
								type="file"
								accept=".zip"
								onChange={(event) => setFile(event.currentTarget.files?.[0])}
							/>
						</label>
						<Button type="submit" disabled={props.pending || file === undefined}>
							Update package
						</Button>
					</form>
					<Button
						variant="secondary"
						disabled={props.pending}
						onClick={() => setConfirmRemoval(true)}
					>
						Uninstall
					</Button>
				</>
			) : (
				<p className="text-sm text-text-muted">
					System package configuration, updates, and removal are deployment administrator actions.
				</p>
			)}
			{confirmRemoval ? (
				<Modal
					closeLabel="Cancel uninstall"
					onClose={() => setConfirmRemoval(false)}
					label={`Uninstall ${label(installation)}`}
				>
					<div className="grid gap-3 p-4">
						<p>
							This targets {installation.pluginId}. Referenced data can prevent removal. No forced
							or destructive uninstall is available.
						</p>
						<Button
							disabled={props.pending}
							onClick={() => {
								props.onAction({ installation, kind: "uninstall" });
								setConfirmRemoval(false);
							}}
						>
							Confirm uninstall
						</Button>
						<Button variant="secondary" onClick={() => setConfirmRemoval(false)}>
							Cancel
						</Button>
					</div>
				</Modal>
			) : null}
		</>
	);
}

export function PluginManagementPanel(props: {
	readonly installations: readonly ManagedPluginInstallation[];
	readonly pending: boolean;
	readonly onAction: (action: PluginManagementAction) => void;
	readonly error?: string | undefined;
	readonly status?: string | undefined;
}) {
	return (
		<div className="grid gap-4">
			<p>
				Package names are metadata, not publisher verification. Unavailable entries below do not
				load plugin client code.
			</p>
			{props.error ? <p role="alert">{props.error}</p> : null}
			{props.status ? <p role="status">{props.status}</p> : null}
			{props.installations.length === 0 ? (
				<p>No plugin installations.</p>
			) : (
				props.installations.map((installation) => (
					<details
						key={installation.installationId}
						className="grid gap-3 rounded border border-border p-3"
					>
						<summary className="cursor-pointer font-medium">
							{label(installation)} · {installation.health}
							{installation.isHidden ? " · Hidden" : ""}
						</summary>
						<div className="grid gap-4 pt-3">
							<InstallationDetails
								pending={props.pending}
								onAction={props.onAction}
								installation={installation}
							/>
						</div>
					</details>
				))
			)}
		</div>
	);
}
