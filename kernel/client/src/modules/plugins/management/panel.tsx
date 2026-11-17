import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	Button,
	DestructiveConfirmation,
	entitlementActionLabel,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ReactNode, useRef, useState } from "react";

import { useEntitlement } from "#/modules/entitlements/context";
import { PluginConfigForm } from "#/modules/plugins/management/config-form";
import type {
	ManagedPluginInstallation,
	PluginManagementAction,
} from "#/modules/plugins/management/service";

const healthPresentation: Record<
	ManagedPluginInstallation["health"],
	{ readonly label: Message; readonly className: string }
> = {
	ready: {
		className: "bg-success-soft text-success",
		label: kernelMessage("client.plugins.health.ready"),
	},
	failed: {
		className: "border border-danger text-danger",
		label: kernelMessage("client.plugins.health.failed"),
	},
	incompatible: {
		className: "border border-warning text-warning",
		label: kernelMessage("client.plugins.health.incompatible"),
	},
	installing: {
		className: "border border-border-strong text-text-muted",
		label: kernelMessage("client.plugins.health.installing"),
	},
	"needs-configuration": {
		className: "border border-warning text-warning",
		label: kernelMessage("client.plugins.health.needs-configuration"),
	},
};

const pillClassName = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";

const compactButtonClassName = "min-h-9 px-3 py-1.5 text-sm";

export type PluginManagementFeedback = {
	readonly message: Text;
	readonly tone: "error" | "success";
	readonly installationId: string | undefined;
};

type InstallationProps = {
	readonly pending: boolean;
	readonly installation: ManagedPluginInstallation;
	readonly feedback: undefined | PluginManagementFeedback;
	readonly onAction: (action: PluginManagementAction) => void;
	readonly onOpenArchive: (installation: ManagedPluginInstallation) => void;
};

export function PluginManagementPanel(props: {
	readonly pending: boolean;
	readonly feedback: undefined | PluginManagementFeedback;
	readonly onAction: (action: PluginManagementAction) => void;
	readonly installations: readonly ManagedPluginInstallation[];
	readonly onOpenArchive: (installation?: ManagedPluginInstallation) => void;
}) {
	const t = useT();
	const pro = useEntitlement("pro");
	return (
		<div className="flex flex-col gap-6 pb-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<p className="text-sm leading-6 text-text-muted">
					{t(kernelMessage("client.plugins.panel.intro"))}
				</p>
				<Button
					variant="primary"
					disabled={props.pending || !pro}
					onClick={() => props.onOpenArchive()}
					className={clsx(compactButtonClassName, "flex shrink-0 items-center gap-1.5 self-start")}
				>
					<AppIcon size={14} name="plus" />
					{entitlementActionLabel(
						t,
						t(kernelMessage("client.plugins.archive.install")),
						"pro",
						pro,
					)}
				</Button>
			</div>
			<Feedback
				feedback={props.feedback?.installationId === undefined ? props.feedback : undefined}
			/>
			{props.installations.length === 0 ? (
				<p className="text-sm text-text-muted">{t(kernelMessage("client.plugins.panel.none"))}</p>
			) : (
				<div className="flex flex-col gap-2">
					{props.installations.map((installation) => (
						<InstallationCard
							pending={props.pending}
							onAction={props.onAction}
							installation={installation}
							key={installation.installationId}
							onOpenArchive={props.onOpenArchive}
							feedback={
								props.feedback?.installationId === installation.installationId
									? props.feedback
									: undefined
							}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function Feedback(props: { readonly feedback: undefined | PluginManagementFeedback }) {
	return props.feedback === undefined ? null : (
		<StatusMessage className="text-sm" tone={props.feedback.tone}>
			{props.feedback.message}
		</StatusMessage>
	);
}

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

function InstallationCard(props: InstallationProps) {
	const t = useT();
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
						<span className="truncate text-sm font-medium text-text">{t(installation.name)}</span>
						<span className="shrink-0 text-xs text-text-subtle">
							{t(kernelMessage("client.plugins.version", { version: installation.version }))}
						</span>
					</span>
					<span className="truncate font-mono text-xs text-text-subtle">
						{installation.packageId}
					</span>
				</span>
				<span className="hidden shrink-0 items-center gap-1.5 sm:flex">
					{installation.isHidden ? (
						<span className={clsx(pillClassName, "border border-border text-text-subtle")}>
							{t(kernelMessage("client.plugins.hidden"))}
						</span>
					) : null}
					<span className={clsx(pillClassName, "border border-border-strong text-text-muted")}>
						{t(
							installation.scope === "system"
								? kernelMessage("client.plugins.scope.system")
								: kernelMessage("client.plugins.scope.private"),
						)}
					</span>
				</span>
				<span className={clsx(pillClassName, health.className)}>{t(health.label)}</span>
				<AppIcon
					size={16}
					name="chevron-down"
					className="shrink-0 text-text-subtle transition-transform group-open:rotate-180"
				/>
			</summary>
			<InstallationDetails
				pending={props.pending}
				feedback={props.feedback}
				onAction={props.onAction}
				installation={installation}
				onOpenArchive={props.onOpenArchive}
			/>
		</details>
	);
}

function InstallationDetails(props: InstallationProps) {
	const t = useT();
	const installation = props.installation;
	const pro = useEntitlement("pro");
	const [confirmRemoval, setConfirmRemoval] = useState(false);
	const uninstallTrigger = useRef<HTMLButtonElement>(null);
	const technicalDetails = [
		[t(kernelMessage("client.plugins.panel.technical.plugin-id")), installation.pluginId],
		[t(kernelMessage("client.plugins.panel.technical.package-id")), installation.packageId],
		[t(kernelMessage("client.plugins.panel.technical.version")), installation.version],
		[
			t(kernelMessage("client.plugins.panel.technical.installation-id")),
			installation.installationId,
		],
		[t(kernelMessage("client.plugins.panel.technical.revision-id")), installation.activeRevisionId],
		[t(kernelMessage("client.plugins.panel.technical.content-hash")), installation.contentHash],
		[
			t(kernelMessage("client.plugins.panel.technical.visibility")),
			t(
				installation.isHidden
					? kernelMessage("client.plugins.hidden")
					: kernelMessage("client.plugins.panel.shown"),
			),
		],
		[
			t(kernelMessage("client.plugins.panel.technical.initialization")),
			t(
				installation.isInitialized
					? kernelMessage("client.plugins.panel.completed")
					: kernelMessage("client.plugins.panel.not-completed"),
			),
		],
		...(installation.incompatibilityReason === null
			? []
			: [
					[
						t(kernelMessage("client.plugins.panel.technical.incompatibility")),
						installation.incompatibilityReason,
					],
				]),
	];
	return (
		<div className="flex flex-col gap-5 border-t border-border px-4 py-4">
			<Feedback feedback={props.feedback} />
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
								{t(kernelMessage("client.plugins.panel.quarantined"))}
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
						{t(
							installation.health === "ready"
								? kernelMessage("client.plugins.panel.show")
								: kernelMessage("client.plugins.panel.re-enable"),
						)}
					</Button>
				) : null}
				{installation.isHidden ? null : (
					<Button
						variant="secondary"
						disabled={props.pending}
						className={compactButtonClassName}
						onClick={() => props.onAction({ installation, kind: "state", isHidden: true })}
					>
						{t(kernelMessage("client.plugins.panel.hide"))}
					</Button>
				)}
				<a
					className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-accent-text"
					href={`/settings/plugin-preferences/${encodeURIComponent(installation.installationId)}`}
				>
					{t(kernelMessage("client.plugins.panel.preferences"))}
					<AppIcon size={14} name="arrow-right" />
				</a>
				<a
					href="/settings/backups"
					className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-accent-text"
				>
					{t(kernelMessage("client.plugins.panel.backup"))}
					<AppIcon size={14} name="arrow-right" />
				</a>
			</div>
			{installation.scope === "user" ? (
				<>
					{Object.keys(installation.configSchema.fields).length === 0 ? null : (
						<DetailsSection title={t(kernelMessage("client.plugins.panel.configuration"))}>
							<PluginConfigForm
								pending={props.pending}
								stored={installation.config}
								schema={installation.configSchema}
								submitClassName={compactButtonClassName}
								pendingLabel={t(kernelMessage("common.status.saving"))}
								submitLabel={t(kernelMessage("client.plugins.panel.save-configuration"))}
								onSubmit={(config) => props.onAction({ config, installation, kind: "configure" })}
								seedKey={`${installation.installationId}:${installation.contentHash}:${JSON.stringify(installation.config)}`}
							/>
						</DetailsSection>
					)}
					<DetailsSection title={t(kernelMessage("client.plugins.panel.package"))}>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								disabled={props.pending || !pro}
								className={compactButtonClassName}
								onClick={() => props.onOpenArchive(installation)}
							>
								{entitlementActionLabel(
									t,
									t(kernelMessage("client.plugins.panel.update-package")),
									"pro",
									pro,
								)}
							</Button>
							<Button
								type="button"
								variant="secondary"
								ref={uninstallTrigger}
								disabled={props.pending}
								onClick={() => setConfirmRemoval(true)}
								className={clsx(compactButtonClassName, "text-danger")}
							>
								{t(kernelMessage("client.plugins.panel.uninstall"))}
							</Button>
						</div>
					</DetailsSection>
				</>
			) : (
				<p className="text-xs text-text-muted">
					{t(kernelMessage("client.plugins.panel.system-note"))}
				</p>
			)}
			<DetailsSection title={t(kernelMessage("client.plugins.panel.technical"))}>
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
					triggerRef={uninstallTrigger}
					onClose={() => setConfirmRemoval(false)}
					pendingLabel={t(kernelMessage("client.plugins.panel.uninstalling"))}
					actionLabel={t(kernelMessage("client.plugins.panel.uninstall-action"))}
					title={t(
						kernelMessage("client.plugins.panel.uninstall-title", { name: t(installation.name) }),
					)}
					onConfirm={() => {
						props.onAction({ installation, kind: "uninstall" });
						setConfirmRemoval(false);
					}}
					detail={t(
						kernelMessage("client.plugins.panel.uninstall-detail", {
							pluginId: installation.pluginId,
						}),
					)}
				/>
			) : null}
		</div>
	);
}
