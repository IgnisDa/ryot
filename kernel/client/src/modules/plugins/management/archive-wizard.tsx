import { stampAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import type { PluginInspection } from "@ryot-app/contract/modules/plugins/schemas";
import { registerCatalog } from "@ryot-app/i18n/catalog";
import { type Message, stampNamespace } from "@ryot-app/i18n/message";
import { I18nProvider, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, Checkbox, FieldMessage, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { pickBrowserUploadFile, SchemaFileField } from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect, Match } from "effect";
import { type ReactNode, useMemo, useState } from "react";

import { useI18nSnapshot } from "#/modules/i18n/provider";
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

const INSPECTION_NAMESPACE = "plugin-archive-inspection";

const STEPS = ["choose", "review", "configure"] as const;

const UNCONFIGURABLE_STEPS = ["choose", "review"] as const;

type Step = (typeof STEPS)[number];

const RISKS = [
	kernelMessage("client.plugins.archive.risk.code"),
	kernelMessage("client.plugins.archive.risk.change"),
	kernelMessage("client.plugins.archive.risk.network"),
	kernelMessage("client.plugins.archive.risk.unverified"),
] satisfies readonly Message[];

const operationHint = (hints: PluginInspection["operations"][number]["hints"]) => {
	if (hints.destructive) {
		return {
			variant: "danger",
			label: kernelMessage("client.plugins.archive.hint.destructive"),
		} as const;
	}
	return hints.readOnly
		? ({
				variant: "neutral",
				label: kernelMessage("client.plugins.archive.hint.read-only"),
			} as const)
		: ({
				variant: "warning",
				label: kernelMessage("client.plugins.archive.hint.changes"),
			} as const);
};

export function PluginArchiveWizard(props: {
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly failureDetail: string | undefined;
	readonly installation?: undefined | ManagedPluginInstallation;
	readonly onSubmit: (submission: PluginArchiveSubmission) => void;
}) {
	const t = useT();
	const isUpdate = props.installation !== undefined;
	const uploadFile = useSchemaFileUpload();
	const inspect = useRyotMutation(pluginArchiveInspectionMutation);
	const [step, setStep] = useState<Step>("choose");
	const [uploadToken, setUploadToken] = useState<string>();
	const [inspection, setInspection] = useState<PluginInspection>();
	const [acknowledged, setAcknowledged] = useState(false);
	const configurable =
		inspection === undefined || Object.keys(inspection.configSchema.fields).length > 0;
	const submitLabel = t(
		isUpdate
			? kernelMessage("client.plugins.archive.update")
			: kernelMessage("client.plugins.archive.install"),
	);
	const pendingLabel = t(
		isUpdate
			? kernelMessage("client.plugins.archive.updating")
			: kernelMessage("client.plugins.archive.installing"),
	);
	let reviewActionLabel = submitLabel;
	if (configurable) {
		reviewActionLabel = t(kernelMessage("common.action.continue"));
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
					{t(
						props.installation === undefined
							? kernelMessage("client.plugins.archive.choose")
							: kernelMessage("client.plugins.archive.choose-new", {
									name: t(props.installation.name),
								}),
					)}
				</p>
				<SchemaFileField
					value={uploadToken}
					icons={schemaFormIcons}
					uploadFile={uploadFile}
					allowedFileExtensions={["zip"]}
					pickFile={pickBrowserUploadFile}
					readyLabel={t(kernelMessage("client.plugins.archive.ready"))}
					label={t(kernelMessage("client.plugins.archive.field-label"))}
					onChange={(token) => {
						inspect.reset();
						setAcknowledged(false);
						setUploadToken(token);
					}}
				/>
				{inspect.error === null ? null : (
					<FieldMessage>{errorDetail(t, inspect.error)}</FieldMessage>
				)}
				<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
					<Button
						type="button"
						variant="primary"
						className="sm:px-6"
						disabled={uploadToken === undefined || inspect.isPending}
						onClick={() => uploadToken !== undefined && review(uploadToken)}
					>
						{t(
							inspect.isPending
								? kernelMessage("client.plugins.archive.checking")
								: kernelMessage("common.action.continue"),
						)}
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
						icon={<AppIcon size={16} name="circle-alert" />}
						title={t(kernelMessage("client.plugins.archive.trust-title"))}
					>
						<ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm text-text-muted">
							{RISKS.map((risk) => (
								<li key={risk.key}>{t(risk)}</li>
							))}
						</ul>
					</Notice>
					<Checkbox
						checked={acknowledged}
						label={t(kernelMessage("client.plugins.archive.acknowledge"))}
						onChange={(event) => setAcknowledged(event.currentTarget.checked)}
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
							{t(kernelMessage("common.action.back"))}
						</Button>
					</div>
				</div>
			),
		),
		Match.when("configure", () =>
			inspection === undefined || uploadToken === undefined ? null : (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-text-muted">
						{t(
							isUpdate
								? kernelMessage("client.plugins.archive.configure-update")
								: kernelMessage("client.plugins.archive.configure-new"),
						)}
					</p>
					{failure}
					<InspectionI18n catalogs={inspection.catalogs}>
						<PluginConfigForm
							pending={props.pending}
							submitLabel={submitLabel}
							pendingLabel={pendingLabel}
							stored={props.installation?.config}
							seedKey={`${uploadToken}:${inspection.metadata.version}`}
							onSubmit={(config) => props.onSubmit({ config, uploadToken })}
							schema={stampAppSchema(INSPECTION_NAMESPACE, inspection.configSchema)}
							actions={
								<Button
									type="button"
									variant="secondary"
									className="sm:px-6"
									disabled={props.pending}
									onClick={() => setStep("review")}
								>
									{t(kernelMessage("common.action.back"))}
								</Button>
							}
						/>
					</InspectionI18n>
				</div>
			),
		),
		Match.exhaustive,
	);

	return (
		<WizardShell
			onClose={props.onClose}
			closeLabel={t(kernelMessage("client.plugins.archive.close"))}
			title={t(
				props.installation === undefined
					? kernelMessage("client.plugins.archive.install")
					: kernelMessage("client.plugins.archive.update-title", {
							name: t(props.installation.name),
						}),
			)}
			stepLabel={wizardStepLabel(step, configurable ? STEPS : UNCONFIGURABLE_STEPS, {
				review: t(kernelMessage("client.plugins.archive.step.review")),
				choose: t(kernelMessage("client.plugins.archive.step.choose")),
				configure: t(kernelMessage("client.plugins.archive.step.configure")),
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
	return (
		<InspectionI18n catalogs={props.inspection.catalogs}>
			<InspectionDetails inspection={props.inspection} installation={props.installation} />
		</InspectionI18n>
	);
}

function InspectionI18n(props: {
	readonly children: ReactNode;
	readonly catalogs: PluginInspection["catalogs"];
}) {
	const { locale, registry } = useI18nSnapshot();
	const { catalogs } = props;
	const inspectionRegistry = useMemo(
		() =>
			Object.entries(catalogs).reduce(
				(current, [catalogLocale, catalog]) =>
					registerCatalog(current, INSPECTION_NAMESPACE, catalogLocale, catalog),
				registry,
			),
		[catalogs, registry],
	);
	return (
		<I18nProvider locale={locale} registry={inspectionRegistry}>
			{props.children}
		</I18nProvider>
	);
}

function InspectionDetails(props: {
	readonly inspection: PluginInspection;
	readonly installation: undefined | ManagedPluginInstallation;
}) {
	const t = useT();
	const { metadata, operations } = props.inspection;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text">
					<AppIcon size={20} name={metadata.icon} />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
						<span className="truncate text-base font-semibold text-text">
							{t(stampNamespace(INSPECTION_NAMESPACE, metadata.name))}
						</span>
						<span className="text-xs text-text-subtle">
							{t(
								props.installation === undefined
									? kernelMessage("client.plugins.version", { version: metadata.version })
									: kernelMessage("client.plugins.version-change", {
											to: metadata.version,
											from: props.installation.version,
										}),
							)}
						</span>
					</p>
					<p className="truncate font-mono text-xs text-text-subtle">{metadata.packageId}</p>
					<p className="text-sm leading-6 text-text-muted">
						{t(stampNamespace(INSPECTION_NAMESPACE, metadata.description))}
					</p>
				</div>
			</div>
			<section className="flex flex-col gap-2">
				<h3 className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
					{t(kernelMessage("client.plugins.archive.operations"))}
				</h3>
				{operations.length === 0 ? (
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.plugins.archive.no-operations"))}
					</p>
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
										{t(hint.label)}
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
