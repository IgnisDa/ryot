import { useRyotMutation } from "@ryot-app/client-sdk/react";
import { StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	initialSchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import { Match } from "effect";
import { useReducer, useState } from "react";

import { ImportInputStep } from "#/modules/imports/input-step";
import { ImportReviewStep } from "#/modules/imports/review-step";
import type { ImportSourceItem } from "#/modules/imports/service";
import { createImportRunMutation } from "#/modules/imports/service";
import { importSourceChooseLabel, importSourceEntry } from "#/modules/imports/source-selection";
import { importStartFailure, type ImportStartFailure } from "#/modules/imports/start-failure";
import { CatalogPicker, type CatalogPickerState } from "#/modules/ui/catalog/picker";
import { findBySlug } from "#/modules/ui/catalog/selection";
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

export const IMPORT_WIZARD_TITLE = "Start an import";

export type ImportSourcePickerState = CatalogPickerState<ImportSourceItem>;

const stepHeadings = {
	pick: "Choose a service",
	review: "Review and start",
	configure: "Provide the details",
} as const satisfies WizardStepHeadings;

const pickerCopy = {
	emptyTitle: "No services yet",
	searchLabel: "Search services",
	loadingLabel: "Loading services",
	errorTitle: "Unable to load services",
	loadingDetail: "Loading the services you can import from...",
	emptyDetail: "Once a plugin on this server contributes an importer, it shows up here.",
	errorDetail: "The list of services could not be loaded. Check the server and try again.",
};

export function ImportStartWizard(props: {
	readonly onClose: () => void;
	readonly onStarted: () => void;
	readonly onRetrySources: () => void;
	readonly sources: ImportSourcePickerState;
}) {
	const uploadFile = useSchemaFileUpload();
	const startMutation = useRyotMutation(createImportRunMutation);
	const [failure, setFailure] = useState<ImportStartFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const listed = props.sources.status === "ready" ? props.sources.sources : [];
	const source = findBySlug(listed, state.slug);
	const schema = source?.inputSchema;

	const startRun = async (values: SchemaFormValues) => {
		if (source === undefined) {
			return;
		}
		setFailure(undefined);
		try {
			await startMutation.mutateAsync({
				source: source.slug,
				...toSchemaFormPayload(source.inputSchema, values),
			});
		} catch (error) {
			const nextFailure = importStartFailure(error);
			setFailure(nextFailure);
			if (nextFailure.step !== undefined) {
				dispatch({ type: "recover-at", step: nextFailure.step });
			}
			return;
		}
		props.onStarted();
		props.onClose();
	};

	const requestReview = () => {
		setFailure(undefined);
		dispatch({ type: "review-requested" });
	};

	const form = useSchemaForm({ schemas: [schema], onSubmit: requestReview });

	useFormSeed(form, state.slug, () =>
		schema === undefined ? {} : initialSchemaFormValues(schema),
	);

	const goBack = () => {
		setFailure(undefined);
		dispatch({ type: "back" });
	};

	const chooseSource = (slug: string) => {
		setFailure(undefined);
		dispatch({ slug, type: "picked" });
	};

	const reviewFailure = failure?.step === undefined ? failure?.detail : undefined;
	const inputFailure = failure?.step === "configure" ? failure.detail : undefined;
	const sourceFailure = failure?.step === "pick" ? failure.detail : undefined;

	const stepBody = Match.value(state.step).pipe(
		Match.when("pick", () => (
			<>
				{sourceFailure === undefined ? null : (
					<StatusMessage tone="error" className="text-sm">
						{sourceFailure}
					</StatusMessage>
				)}
				<CatalogPicker
					copy={pickerCopy}
					state={props.sources}
					onChoose={chooseSource}
					toEntry={importSourceEntry}
					onRetry={props.onRetrySources}
					chooseLabel={importSourceChooseLabel}
				/>
			</>
		)),
		Match.when("configure", () =>
			source === undefined ? null : (
				<ImportInputStep
					form={form}
					onBack={goBack}
					source={source}
					uploadFile={uploadFile}
					failureDetail={inputFailure}
					onContinue={() => void form.handleSubmit()}
				/>
			),
		),
		Match.when("review", () =>
			source === undefined ? null : (
				<form.Subscribe selector={(formState) => formState.values}>
					{(values) => (
						<ImportReviewStep
							source={source}
							values={values}
							onBack={goBack}
							failureDetail={reviewFailure}
							pending={startMutation.isPending}
							onStart={() => void startRun(values)}
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
			title={IMPORT_WIZARD_TITLE}
			closeLabel="Close the import wizard"
			stepLabel={wizardStepLabel(state.step, WIZARD_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
