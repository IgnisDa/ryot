import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useSchemaAssetUpload } from "@ryot-app/plugin-client-sdk/react";
import { Button, FieldMessage, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import {
	type SchemaAssetUpload,
	type SchemaFileUpload,
	type SchemaFormApi,
	type SchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Cause, Effect, Match } from "effect";
import { useReducer, useState } from "react";

import { SelectedIntegrationReadiness } from "#/modules/imports/selected-readiness";
import { useOAuthConnect } from "#/modules/integrations/oauth-connect";
import {
	createIntegrationBody,
	initialIntegrationFormValues,
} from "#/modules/integrations/payload";
import {
	integrationLotDetail,
	integrationLotLabel,
	integrationProviderChooseLabel,
	integrationProviderEntry,
	integrationProviderItemKey,
} from "#/modules/integrations/provider-selection";
import {
	type IntegrationSaveFailure,
	integrationSaveFailure,
} from "#/modules/integrations/save-failure";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { createIntegrationMutation } from "#/modules/integrations/service";
import { IntegrationSettingsForm } from "#/modules/integrations/settings-form";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { CatalogPicker, type CatalogPickerState } from "#/modules/ui/catalog/picker";
import { pluginNamesByInstallation } from "#/modules/ui/catalog/selection";
import { schemaReviewRows } from "#/modules/ui/review-rows";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";
import { useLatestDefined } from "#/modules/ui/use-latest-defined";
import { WizardShell } from "#/modules/ui/wizard/wizard-shell";
import {
	createWizardState,
	WIZARD_STEPS,
	wizardReducer,
	type WizardStepHeadings,
	wizardStepLabel,
} from "#/modules/ui/wizard/wizard-state";

export type IntegrationProviderPickerState = CatalogPickerState<IntegrationProviderItem>;

type CreateWizardProps = {
	readonly onClose: () => void;
	readonly onCreated: () => void;
	readonly onRetryProviders: () => void;
	readonly providers: IntegrationProviderPickerState;
};

export function IntegrationCreateWizard(props: CreateWizardProps) {
	const t = useT();
	const pluginNames = pluginNamesByInstallation(usePluginCatalog().catalog);
	const stepHeadings = {
		pick: t(kernelMessage("client.ui.wizard.service.step-pick")),
		configure: t(kernelMessage("client.ui.wizard.step.configure")),
		review: t(kernelMessage("client.integrations.wizard.step.review")),
	} as const satisfies WizardStepHeadings;
	const pickerCopy = {
		searchLabel: t(kernelMessage("client.ui.wizard.service.search")),
		loadingLabel: t(kernelMessage("client.ui.wizard.service.loading")),
		emptyTitle: t(kernelMessage("client.ui.wizard.service.empty-title")),
		errorTitle: t(kernelMessage("client.ui.wizard.service.error-title")),
		errorDetail: t(kernelMessage("client.ui.wizard.service.error-detail")),
		emptyDetail: t(kernelMessage("client.integrations.wizard.empty-detail")),
		loadingDetail: t(kernelMessage("client.integrations.wizard.loading-detail")),
	};
	const uploadFile = useSchemaFileUpload();
	const uploadAsset = useSchemaAssetUpload();
	const create = useRyotMutation(createIntegrationMutation);
	const [failure, setFailure] = useState<undefined | IntegrationSaveFailure>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const listed = props.providers.status === "ready" ? props.providers.sources : [];
	const provider = useLatestDefined(
		listed.find((item) => integrationProviderItemKey(item) === state.slug),
	);

	const connect = (values: SchemaFormValues) => {
		return Effect.runPromise(
			Effect.gen(function* () {
				if (provider === undefined) {
					return;
				}
				setFailure(undefined);
				yield* create.mutateEffect(createIntegrationBody({ values, provider })).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							props.onCreated();
							props.onClose();
						}),
					),
					Effect.catchCause((cause) =>
						Effect.sync(() => {
							const saveFailure = integrationSaveFailure(Cause.squash(cause));
							setFailure(saveFailure);
							if (saveFailure.step !== undefined) {
								dispatch({ type: "recover-at", step: saveFailure.step });
							}
						}),
					),
				);
			}),
		);
	};

	const requestReview = () => {
		setFailure(undefined);
		dispatch({ type: "review-requested" });
	};

	const form = useSchemaForm({
		onSubmit: requestReview,
		schemas: [provider?.commonSchema, provider?.settingsSchema],
	});

	useFormSeed(form, state.slug, () =>
		provider === undefined ? {} : initialIntegrationFormValues(provider),
	);

	const goBack = () => {
		setFailure(undefined);
		dispatch({ type: "back" });
	};

	const chooseProvider = (slug: string) => {
		setFailure(undefined);
		dispatch({ slug, type: "picked" });
	};

	const reviewFailure = failure?.step === undefined ? failure?.detail : undefined;
	const settingsFailure = failure?.step === "configure" ? failure.detail : undefined;
	const providerFailure = failure?.step === "pick" ? failure.detail : undefined;

	const stepBody = Match.value(state.step).pipe(
		Match.when("pick", () => (
			<>
				{providerFailure === undefined ? null : (
					<StatusMessage tone="error" className="text-sm">
						{t(providerFailure)}
					</StatusMessage>
				)}
				<CatalogPicker
					copy={pickerCopy}
					state={props.providers}
					onChoose={chooseProvider}
					onRetry={props.onRetryProviders}
					chooseLabel={(entry) => integrationProviderChooseLabel(t, entry)}
					toEntry={(item) => integrationProviderEntry(item, t, pluginNames)}
				/>
			</>
		)),
		Match.when("configure", () =>
			provider === undefined ? null : (
				<SettingsStep
					form={form}
					onBack={goBack}
					provider={provider}
					uploadFile={uploadFile}
					uploadAsset={uploadAsset}
					failureDetail={settingsFailure}
					onContinue={() => void form.handleSubmit()}
				/>
			),
		),
		Match.when("review", () =>
			provider === undefined ? null : (
				<form.Subscribe selector={(formState) => formState.values.fields}>
					{(values) => (
						<ReviewStep
							values={values}
							onBack={goBack}
							provider={provider}
							pending={create.isPending}
							failureDetail={reviewFailure}
							onConnect={() => void connect(values)}
						/>
					)}
				</form.Subscribe>
			),
		),
		Match.exhaustive,
	);

	return (
		<WizardShell
			onClose={props.onClose}
			title={t(kernelMessage("client.integrations.wizard.title"))}
			closeLabel={t(kernelMessage("client.integrations.wizard.close"))}
			stepLabel={wizardStepLabel(state.step, WIZARD_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}

function SettingsStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly uploadAsset: SchemaAssetUpload;
	readonly provider: IntegrationProviderItem;
	readonly failureDetail: Message | undefined;
}) {
	const t = useT();
	const oauth = useOAuthConnect({ integrationProvider: props.provider.reference });
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 className="font-display text-lg font-semibold text-text">{t(props.provider.name)}</h3>
				<p className="text-sm leading-6 text-text-muted">{t(props.provider.description)}</p>
			</div>
			<IntegrationSettingsForm
				mode="create"
				form={props.form}
				provider={props.provider}
				connectOAuth={oauth.connect}
				uploadFile={props.uploadFile}
				uploadAsset={props.uploadAsset}
				oauthDisabledReason={oauth.disabledReason}
			/>
			<props.form.Subscribe selector={(state) => state.values.fields}>
				{(values) => (
					<SelectedIntegrationReadiness
						reference={props.provider.reference}
						settings={toSchemaFormPayload(props.provider.settingsSchema, values)}
					>
						{() => null}
					</SelectedIntegrationReadiness>
				)}
			</props.form.Subscribe>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{t(props.failureDetail)}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button type="button" variant="primary" className="sm:px-6" onClick={props.onContinue}>
					{t(kernelMessage("common.action.continue"))}
				</Button>
				<Button type="button" variant="secondary" className="sm:px-6" onClick={props.onBack}>
					{t(kernelMessage("common.action.back"))}
				</Button>
			</div>
		</div>
	);
}

function ReviewStep(props: {
	readonly pending: boolean;
	readonly onBack: () => void;
	readonly onConnect: () => void;
	readonly values: SchemaFormValues;
	readonly provider: IntegrationProviderItem;
	readonly failureDetail: Message | undefined;
}) {
	const t = useT();
	const formatters = useFormatters();
	const rows = [
		...schemaReviewRows(formatters, t, props.provider.settingsSchema, props.values),
		...schemaReviewRows(formatters, t, props.provider.commonSchema, props.values),
	];
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
						{t(props.provider.name)}
					</span>
					<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
						{t(integrationLotLabel(props.provider.lot))}
					</span>
				</div>
				{rows.length === 0 ? (
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.ui.wizard.service.nothing-needed"))}
					</p>
				) : (
					<div className="flex flex-col gap-2">
						{rows.map((row) => (
							<div
								key={row.label}
								className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
							>
								<span className="text-xs text-text-subtle sm:w-40">{row.label}</span>
								<span className="min-w-0 flex-1 text-sm font-medium text-text">{row.value}</span>
							</div>
						))}
					</div>
				)}
			</div>
			<p className="text-sm leading-6 text-text-muted">
				{t(integrationLotDetail(props.provider.lot))}
			</p>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{t(props.failureDetail)}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<SelectedIntegrationReadiness
					reference={props.provider.reference}
					settings={toSchemaFormPayload(props.provider.settingsSchema, props.values)}
				>
					{(ready) => (
						<Button
							type="button"
							variant="primary"
							className="sm:px-6"
							onClick={props.onConnect}
							disabled={props.pending || !ready}
						>
							{t(
								props.pending
									? kernelMessage("client.integrations.wizard.connecting")
									: kernelMessage("client.integrations.wizard.connect"),
							)}
						</Button>
					)}
				</SelectedIntegrationReadiness>
				<Button
					type="button"
					variant="secondary"
					className="sm:px-6"
					onClick={props.onBack}
					disabled={props.pending}
				>
					{t(kernelMessage("common.action.back"))}
				</Button>
			</div>
		</div>
	);
}
