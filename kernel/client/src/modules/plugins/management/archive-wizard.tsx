import type { PluginInspection } from "@ryot-app/contract/modules/plugins/schemas";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, Checkbox, FieldMessage, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { pickBrowserUploadFile, SchemaFileField } from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect, Match } from "effect";
import { useState } from "react";

import { PluginConfigForm } from "#/modules/plugins/management/config-form";
import {
	errorDetail,
	type ManagedPluginInstallation,
	pluginArchiveInspectionMutation,
	type PluginArchiveSubmission,
} from "#/modules/plugins/management/service";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { WizardShell } from "#/modules/ui/wizard/wizard-shell";
import { wizardStepLabel } from "#/modules/ui/wizard/wizard-state";

const STEPS = ["choose", "review", "configure"] as const;

const UNCONFIGURABLE_STEPS = ["choose", "review"] as const;

type Step = (typeof STEPS)[number];

const RISKS = [
	"It runs code with access to all of your data in Ryot.",
	"It can change and delete your data.",
	"It can contact any server on the internet.",
	"Ryot does not verify who published it. Checking the archive is your responsibility.",
];

const operationHint = (hints: PluginInspection["operations"][number]["hints"]) => {
	if (hints.destructive) {
		return { variant: "danger", label: "Can delete data" } as const;
	}
	return hints.readOnly
		? ({ label: "Read-only", variant: "neutral" } as const)
		: ({ variant: "warning", label: "Changes data" } as const);
};

export function PluginArchiveWizard(props: {
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly failureDetail: string | undefined;
	readonly installation?: undefined | ManagedPluginInstallation;
	readonly onSubmit: (submission: PluginArchiveSubmission) => void;
}) {
	const isUpdate = props.installation !== undefined;
	const uploadFile = useSchemaFileUpload();
	const inspect = useRyotMutation(pluginArchiveInspectionMutation);
	const [step, setStep] = useState<Step>("choose");
	const [uploadToken, setUploadToken] = useState<string>();
	const [inspection, setInspection] = useState<PluginInspection>();
	const [acknowledged, setAcknowledged] = useState(false);
	const configurable =
		inspection === undefined || Object.keys(inspection.configSchema.fields).length > 0;
	const submitLabel = isUpdate ? "Update plugin" : "Install plugin";
	const pendingLabel = isUpdate ? "Updating..." : "Installing...";
	let reviewActionLabel = submitLabel;
	if (configurable) {
		reviewActionLabel = "Continue";
	} else if (props.pending) {
		reviewActionLabel = pendingLabel;
	}
	const failure =
		props.failureDetail === undefined ? null : <FieldMessage>{props.failureDetail}</FieldMessage>;

	const review = (token: string) =>
		void Effect.runPromise(
			inspect.mutateEffect({ uploadToken: token, installation: props.installation }).pipe(
				Effect.tap((result) =>
					Effect.sync(() => {
						setInspection(result);
						setStep("review");
					}),
				),
				Effect.ignore,
			),
		);

	const stepBody = Match.value(step).pipe(
		Match.when("choose", () => (
			<div className="flex flex-col gap-4">
				<p className="text-sm leading-6 text-text-muted">
					{props.installation === undefined
						? "Choose a plugin archive (.zip) built with the Ryot CLI. Ryot checks it before anything is installed."
						: `Choose the new archive for ${props.installation.name}. Its package ID must match the installed one.`}
				</p>
				<SchemaFileField
					value={uploadToken}
					label="Plugin archive"
					icons={schemaFormIcons}
					uploadFile={uploadFile}
					readyLabel="Ready to review"
					allowedFileExtensions={["zip"]}
					pickFile={pickBrowserUploadFile}
					onChange={(token) => {
						inspect.reset();
						setAcknowledged(false);
						setUploadToken(token);
					}}
				/>
				{inspect.error === null ? null : <FieldMessage>{errorDetail(inspect.error)}</FieldMessage>}
				<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
					<Button
						type="button"
						variant="primary"
						className="sm:px-6"
						disabled={uploadToken === undefined || inspect.isPending}
						onClick={() => uploadToken !== undefined && review(uploadToken)}
					>
						{inspect.isPending ? "Checking archive..." : "Continue"}
					</Button>
				</div>
			</div>
		)),
		Match.when("review", () =>
			inspection === undefined || uploadToken === undefined ? null : (
				<div className="flex flex-col gap-5">
					<InspectionSummary inspection={inspection} installation={props.installation} />
					<Notice
						tone="warning"
						title="Only install plugins you trust"
						icon={<AppIcon size={16} name="circle-alert" />}
					>
						<ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm text-text-muted">
							{RISKS.map((risk) => (
								<li key={risk}>{risk}</li>
							))}
						</ul>
					</Notice>
					<Checkbox
						checked={acknowledged}
						onChange={(event) => setAcknowledged(event.currentTarget.checked)}
						label="I understand these risks and trust this plugin's publisher."
					/>
					{configurable ? null : failure}
					<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
						<Button
							type="button"
							variant="primary"
							className="sm:px-6"
							disabled={!acknowledged || props.pending}
							onClick={() =>
								configurable ? setStep("configure") : props.onSubmit({ config: {}, uploadToken })
							}
						>
							{reviewActionLabel}
						</Button>
						<Button
							type="button"
							variant="secondary"
							className="sm:px-6"
							disabled={props.pending}
							onClick={() => setStep("choose")}
						>
							Back
						</Button>
					</div>
				</div>
			),
		),
		Match.when("configure", () =>
			inspection === undefined || uploadToken === undefined ? null : (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-text-muted">
						{isUpdate
							? "Review the configuration for the new version. Secrets you leave blank keep their current values."
							: "Set the plugin's initial configuration. You can change it later from this screen."}
					</p>
					{failure}
					<PluginConfigForm
						pending={props.pending}
						submitLabel={submitLabel}
						pendingLabel={pendingLabel}
						schema={inspection.configSchema}
						stored={props.installation?.config}
						seedKey={`${uploadToken}:${inspection.metadata.version}`}
						onSubmit={(config) => props.onSubmit({ config, uploadToken })}
						actions={
							<Button
								type="button"
								variant="secondary"
								className="sm:px-6"
								disabled={props.pending}
								onClick={() => setStep("review")}
							>
								Back
							</Button>
						}
					/>
				</div>
			),
		),
		Match.exhaustive,
	);

	return (
		<WizardShell
			onClose={props.onClose}
			closeLabel="Close the plugin archive wizard"
			title={
				props.installation === undefined ? "Install plugin" : `Update ${props.installation.name}`
			}
			stepLabel={wizardStepLabel(step, configurable ? STEPS : UNCONFIGURABLE_STEPS, {
				configure: "Configure",
				review: "Review the plugin",
				choose: "Choose the archive",
			})}
		>
			{stepBody}
		</WizardShell>
	);
}

function InspectionSummary(props: {
	readonly inspection: PluginInspection;
	readonly installation: undefined | ManagedPluginInstallation;
}) {
	const { metadata, operations } = props.inspection;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text">
					<AppIcon size={20} name={metadata.icon} />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
						<span className="truncate text-base font-semibold text-text">{metadata.name}</span>
						<span className="text-xs text-text-subtle">
							{props.installation === undefined
								? `v${metadata.version}`
								: `v${props.installation.version} → v${metadata.version}`}
						</span>
					</p>
					<p className="truncate font-mono text-xs text-text-subtle">{metadata.packageId}</p>
					{metadata.description === "" ? null : (
						<p className="text-sm leading-6 text-text-muted">{metadata.description}</p>
					)}
				</div>
			</div>
			<section className="flex flex-col gap-2">
				<h3 className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
					Operations
				</h3>
				{operations.length === 0 ? (
					<p className="text-sm text-text-muted">This plugin declares no operations.</p>
				) : (
					<ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
						{operations.map((operation) => {
							const hint = operationHint(operation.hints);
							return (
								<li key={operation.slug} className="flex items-start gap-3 px-3 py-2.5">
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="text-sm font-medium text-text">{operation.title}</span>
										<span className="text-xs leading-5 text-text-muted">
											{operation.description}
										</span>
									</div>
									<Badge size="sm" variant={hint.variant}>
										{hint.label}
									</Badge>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}
