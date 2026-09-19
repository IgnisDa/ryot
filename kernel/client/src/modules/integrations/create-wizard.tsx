import { useRyotMutation } from "@ryot-app/client-sdk/react";
import { Button, FieldMessage, StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	useSchemaForm,
	type SchemaFileUpload,
	type SchemaFormApi,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import { Match } from "effect";
import { useReducer, useState } from "react";

import {
	createIntegrationBody,
	initialIntegrationFormValues,
} from "#/modules/integrations/payload";
import {
	integrationLotDetail,
	integrationLotLabel,
	integrationProviderChooseLabel,
	integrationProviderEntry,
} from "#/modules/integrations/provider-selection";
import {
	integrationSaveFailure,
	type IntegrationSaveFailure,
} from "#/modules/integrations/save-failure";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { createIntegrationMutation } from "#/modules/integrations/service";
import { IntegrationSettingsForm } from "#/modules/integrations/settings-form";
import { CatalogPicker, type CatalogPickerState } from "#/modules/ui/catalog/picker";
import { findBySlug } from "#/modules/ui/catalog/selection";
import { schemaReviewRows } from "#/modules/ui/review-rows";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";
import { WizardShell } from "#/modules/ui/wizard/wizard-shell";
import {
	createWizardState,
	wizardReducer,
	WIZARD_STEPS,
	wizardStepLabel,
	type WizardStepHeadings,
} from "#/modules/ui/wizard/wizard-state";

export const INTEGRATION_WIZARD_TITLE = "Connect a service";

export type IntegrationProviderPickerState = CatalogPickerState<IntegrationProviderItem>;

const stepHeadings = {
	pick: "Choose a service",
	review: "Review and connect",
	configure: "Provide the details",
} as const satisfies WizardStepHeadings;

const pickerCopy = {
	emptyTitle: "No services yet",
	searchLabel: "Search services",
	loadingLabel: "Loading services",
	errorTitle: "Unable to load services",
	loadingDetail: "Loading the services you can connect...",
	errorDetail: "The list of services could not be loaded. Check the server and try again.",
	emptyDetail: "Once a plugin on this server contributes an integration, it shows up here.",
};

type CreateWizardProps = {
	readonly onClose: () => void;
	readonly onCreated: () => void;
	readonly onRetryProviders: () => void;
	readonly providers: IntegrationProviderPickerState;
};

function SettingsStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly failureDetail: string | undefined;
	readonly provider: IntegrationProviderItem;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 className="font-display text-lg font-semibold text-text">{props.provider.name}</h3>
				<p className="text-sm leading-6 text-text-muted">{props.provider.description}</p>
			</div>
			<IntegrationSettingsForm
				mode="create"
				form={props.form}
				provider={props.provider}
				uploadFile={props.uploadFile}
			/>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{props.failureDetail}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button type="button" variant="primary" className="sm:px-6" onClick={props.onContinue}>
					Continue
				</Button>
				<Button type="button" variant="secondary" className="sm:px-6" onClick={props.onBack}>
					Back
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
	readonly failureDetail: string | undefined;
	readonly provider: IntegrationProviderItem;
}) {
	const rows = [
		...schemaReviewRows(props.provider.settingsSchema, props.values),
		...schemaReviewRows(props.provider.commonSchema, props.values),
	];
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
						{props.provider.name}
					</span>
					<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
						{integrationLotLabel(props.provider.lot)}
					</span>
				</div>
				{rows.length === 0 ? (
					<p className="text-sm text-text-muted">This service needs nothing else from you.</p>
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
				{integrationLotDetail(props.provider.lot)}
			</p>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{props.failureDetail}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					disabled={props.pending}
					onClick={props.onConnect}
				>
					{props.pending ? "Connecting..." : "Connect"}
				</Button>
				<Button
					type="button"
					variant="secondary"
					className="sm:px-6"
					onClick={props.onBack}
					disabled={props.pending}
				>
					Back
				</Button>
			</div>
		</div>
	);
}

export function IntegrationCreateWizard(props: CreateWizardProps) {
	const uploadFile = useSchemaFileUpload();
	const create = useRyotMutation(createIntegrationMutation);
	const [failure, setFailure] = useState<IntegrationSaveFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const listed = props.providers.status === "ready" ? props.providers.sources : [];
	const provider = findBySlug(listed, state.slug);

	const connect = async (values: SchemaFormValues) => {
		if (provider === undefined) {
			return;
		}
		setFailure(undefined);
		try {
			await create.mutateAsync(createIntegrationBody({ values, provider }));
		} catch (error) {
			const saveFailure = integrationSaveFailure(error);
			setFailure(saveFailure);
			if (saveFailure.step !== undefined) {
				dispatch({ type: "recover-at", step: saveFailure.step });
			}
			return;
		}
		props.onCreated();
		props.onClose();
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
						{providerFailure}
					</StatusMessage>
				)}
				<CatalogPicker
					copy={pickerCopy}
					state={props.providers}
					onChoose={chooseProvider}
					onRetry={props.onRetryProviders}
					toEntry={integrationProviderEntry}
					chooseLabel={integrationProviderChooseLabel}
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
					failureDetail={settingsFailure}
					onContinue={() => void form.handleSubmit()}
				/>
			),
		),
		Match.when("review", () =>
			provider === undefined ? null : (
				<form.Subscribe selector={(formState) => formState.values}>
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
			title={INTEGRATION_WIZARD_TITLE}
			closeLabel="Close the integration wizard"
			stepLabel={wizardStepLabel(state.step, WIZARD_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
