import {
	Button,
	DestructiveConfirmation,
	StatusMessage,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ReactNode, useRef, useState } from "react";

import type {
	ManagedPluginInstallation,
	PluginManagementAction,
} from "#/modules/plugins/management/service";

const healthPresentation: Record<
	ManagedPluginInstallation["health"],
	{ readonly label: string; readonly className: string }
> = {
	ready: { label: "Ready", className: "bg-success-soft text-success" },
	failed: { label: "Failed", className: "border border-danger text-danger" },
	incompatible: { label: "Incompatible", className: "border border-warning text-warning" },
	installing: { label: "Installing", className: "border border-border-strong text-text-muted" },
	"needs-configuration": {
		label: "Needs configuration",
		className: "border border-warning text-warning",
	},
};

const pillClassName = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";

const compactButtonClassName = "min-h-9 px-3 py-1.5 text-sm";

function DetailsSection(props: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
				{props.title}
			</h3>
			{props.children}
		</section>
	);
}

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
	const uninstallTrigger = useRef<HTMLButtonElement>(null);
	const technicalDetails = [
		["Plugin ID", installation.pluginId],
		["Package ID", installation.packageId],
		["Version", installation.version],
		["Installation ID", installation.installationId],
		["Active revision ID", installation.activeRevisionId],
		["Content hash", installation.contentHash],
		["Visibility", installation.isHidden ? "Hidden" : "Shown"],
		["Initialization", installation.isInitialized ? "Completed" : "Not completed"],
		...(installation.incompatibilityReason === null
			? []
			: [["Incompatibility reason", installation.incompatibilityReason]]),
	];
	return (
		<div className="flex flex-col gap-5 border-t border-border px-4 py-4">
			{installation.healthReason === null &&
			installation.incompatibilityReason !== "package-identity-conflict" ? null : (
				<div
					role="status"
					className="flex gap-2.5 rounded-lg border border-warning/40 bg-surface-2 px-3 py-2.5 text-sm text-text"
				>
					<AppIcon size={16} name="circle-alert" className="mt-0.5 shrink-0 text-warning" />
					<div className="flex flex-col gap-1">
						{installation.healthReason === null ? null : <p>{installation.healthReason}</p>}
						{installation.incompatibilityReason === "package-identity-conflict" ? (
							<p className="text-text-muted">
								This private package is quarantined. Its data and exact references remain private.
								Re-enabling validates the retained package; it does not select the system copy.
							</p>
						) : null}
					</div>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{installation.isHidden || installation.health !== "ready" ? (
					<Button
						disabled={props.pending}
						className={compactButtonClassName}
						onClick={() => props.onAction({ installation, kind: "state", isHidden: false })}
					>
						{installation.health === "ready" ? "Show" : "Re-enable"}
					</Button>
				) : null}
				{installation.isHidden ? null : (
					<Button
						variant="secondary"
						disabled={props.pending}
						className={compactButtonClassName}
						onClick={() => props.onAction({ installation, kind: "state", isHidden: true })}
					>
						Hide
					</Button>
				)}
				<a
					className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-accent-text"
					href={`/settings/plugin-preferences/${encodeURIComponent(installation.installationId)}`}
				>
					User preferences
					<AppIcon size={14} name="arrow-right" />
				</a>
				<a
					href="/settings/backups"
					className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-accent-text"
				>
					Back up retained data
					<AppIcon size={14} name="arrow-right" />
				</a>
			</div>
			{installation.scope === "user" ? (
				<>
					<DetailsSection title="Configuration">
						<form
							className="flex flex-col gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								props.onAction({ config, unsetKeys, installation, kind: "configure" });
							}}
						>
							<label className="flex flex-col gap-1.5 text-sm font-medium text-text-muted">
								Configuration JSON
								<TextArea
									value={config}
									density="compact"
									className="min-h-32 font-mono"
									onChange={(event) => setConfig(event.currentTarget.value)}
								/>
							</label>
							<label className="flex flex-col gap-1.5 text-sm font-medium text-text-muted">
								Unset configuration keys (comma separated)
								<TextField
									value={unsetKeys}
									density="compact"
									onChange={(event) => setUnsetKeys(event.currentTarget.value)}
								/>
							</label>
							<p className="text-xs text-text-muted">
								Configured secrets:{" "}
								{installation.configuredSecrets.length === 0
									? "None"
									: installation.configuredSecrets.join(", ")}
								. Existing secret values are not shown; omit a key to preserve it.
							</p>
							<Button
								type="submit"
								disabled={props.pending}
								className={clsx(compactButtonClassName, "self-start")}
							>
								Save configuration
							</Button>
						</form>
					</DetailsSection>
					<DetailsSection title="Package">
						<form
							className="flex flex-col gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								if (file) {
									props.onAction({ file, installation, kind: "package" });
								}
							}}
						>
							<label className="flex flex-col gap-1.5 text-sm font-medium text-text-muted">
								Replacement plugin archive
								<input
									type="file"
									accept=".zip"
									onChange={(event) => setFile(event.currentTarget.files?.[0])}
									className="text-sm text-text file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-transparent file:px-3 file:py-1.5 file:font-semibold file:text-text"
								/>
							</label>
							<div className="flex flex-wrap gap-2">
								<Button
									type="submit"
									className={compactButtonClassName}
									disabled={props.pending || file === undefined}
								>
									Update package
								</Button>
								<Button
									type="button"
									variant="secondary"
									ref={uninstallTrigger}
									disabled={props.pending}
									onClick={() => setConfirmRemoval(true)}
									className={clsx(compactButtonClassName, "text-danger")}
								>
									Uninstall
								</Button>
							</div>
						</form>
					</DetailsSection>
				</>
			) : (
				<p className="text-xs text-text-muted">
					System package configuration, updates, and removal are deployment administrator actions.
				</p>
			)}
			<DetailsSection title="Technical details">
				<dl className="grid gap-x-4 gap-y-2 rounded-lg bg-surface-2 px-3 py-3 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
					{technicalDetails.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="text-text-muted">{name}</dt>
							<dd className="mb-1 break-all font-mono text-text sm:mb-0">{value}</dd>
						</div>
					))}
				</dl>
			</DetailsSection>
			{confirmRemoval ? (
				<DestructiveConfirmation
					pending={props.pending}
					errorMessage={undefined}
					pendingLabel="Uninstalling…"
					triggerRef={uninstallTrigger}
					actionLabel="Uninstall plugin"
					onClose={() => setConfirmRemoval(false)}
					title={`Uninstall ${installation.name}?`}
					onConfirm={() => {
						props.onAction({ installation, kind: "uninstall" });
						setConfirmRemoval(false);
					}}
					detail={`This targets ${installation.pluginId}. Referenced data can prevent removal. No forced or destructive uninstall is available.`}
				/>
			) : null}
		</div>
	);
}

function InstallationCard(props: {
	readonly installation: ManagedPluginInstallation;
	readonly pending: boolean;
	readonly onAction: (action: PluginManagementAction) => void;
}) {
	const installation = props.installation;
	const health = healthPresentation[installation.health];
	return (
		<details className="group rounded-xl border border-border bg-surface">
			<summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
				<span
					className={clsx(
						"flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text",
						installation.isHidden && "opacity-60",
					)}
				>
					<AppIcon size={18} name={installation.icon} />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="truncate text-sm font-medium text-text">{installation.name}</span>
						<span className="shrink-0 text-xs text-text-subtle">v{installation.version}</span>
					</span>
					<span className="truncate font-mono text-xs text-text-subtle">
						{installation.packageId}
					</span>
				</span>
				<span className="hidden shrink-0 items-center gap-1.5 sm:flex">
					{installation.isHidden ? (
						<span className={clsx(pillClassName, "border border-border text-text-subtle")}>
							Hidden
						</span>
					) : null}
					<span className={clsx(pillClassName, "border border-border-strong text-text-muted")}>
						{installation.scope === "system" ? "System" : "Private"}
					</span>
				</span>
				<span className={clsx(pillClassName, health.className)}>{health.label}</span>
				<AppIcon
					size={16}
					name="chevron-down"
					className="shrink-0 text-text-subtle transition-transform group-open:rotate-180"
				/>
			</summary>
			<InstallationDetails
				pending={props.pending}
				onAction={props.onAction}
				installation={installation}
			/>
		</details>
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
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">
				Plugins add workspaces, views, and data types to Ryot. Package names are metadata, not
				publisher verification. Unavailable entries do not load plugin client code.
			</p>
			{props.error ? (
				<StatusMessage tone="error" className="text-sm">
					{props.error}
				</StatusMessage>
			) : null}
			{props.status ? (
				<StatusMessage tone="success" className="text-sm">
					{props.status}
				</StatusMessage>
			) : null}
			{props.installations.length === 0 ? (
				<p className="text-sm text-text-muted">No plugin installations.</p>
			) : (
				<div className="flex flex-col gap-2">
					{props.installations.map((installation) => (
						<InstallationCard
							pending={props.pending}
							onAction={props.onAction}
							installation={installation}
							key={installation.installationId}
						/>
					))}
				</div>
			)}
		</div>
	);
}
