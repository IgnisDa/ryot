import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useSchemaAssetUpload } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import {
	initialSchemaFormValues,
	type SchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Cause, Effect, Match } from "effect";
import { useReducer, useState } from "react";

import { ImportInputStep } from "#/modules/imports/input-step";
import { ImportReviewStep } from "#/modules/imports/review-step";
import { createImportRunMutation, type ImportSourceItem } from "#/modules/imports/service";
import {
	importSourceChooseLabel,
	importSourceEntry,
	importSourceKey,
} from "#/modules/imports/source-selection";
import { type ImportStartFailure, importStartFailure } from "#/modules/imports/start-failure";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { CatalogPicker, type CatalogPickerState } from "#/modules/ui/catalog/picker";
import { pluginNamesByInstallation } from "#/modules/ui/catalog/selection";
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

import { SelectedImportReadiness } from "./selected-readiness";

export type ImportSourcePickerState = CatalogPickerState<ImportSourceItem>;

export function ImportStartWizard(props: {
	readonly onClose: () => void;
	readonly onStarted: () => void;
	readonly onRetrySources: () => void;
	readonly sources: ImportSourcePickerState;
}) {
	const t = useT();
	const formatters = useFormatters();
	const pluginNames = pluginNamesByInstallation(usePluginCatalog().catalog);
	const stepHeadings = {
		pick: t(kernelMessage("client.ui.wizard.service.step-pick")),
		review: t(kernelMessage("client.imports.wizard.step.review")),
		configure: t(kernelMessage("client.ui.wizard.step.configure")),
	} as const satisfies WizardStepHeadings;
	const pickerCopy = {
		searchLabel: t(kernelMessage("client.ui.wizard.service.search")),
		loadingLabel: t(kernelMessage("client.ui.wizard.service.loading")),
		emptyDetail: t(kernelMessage("client.imports.wizard.empty-detail")),
		emptyTitle: t(kernelMessage("client.ui.wizard.service.empty-title")),
		errorTitle: t(kernelMessage("client.ui.wizard.service.error-title")),
		errorDetail: t(kernelMessage("client.ui.wizard.service.error-detail")),
		loadingDetail: t(kernelMessage("client.imports.wizard.loading-detail")),
	};
	const uploadFile = useSchemaFileUpload();
	const uploadAsset = useSchemaAssetUpload();
	const startMutation = useRyotMutation(createImportRunMutation);
	const [failure, setFailure] = useState<undefined | ImportStartFailure>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const listed = props.sources.status === "ready" ? props.sources.sources : [];
	const source = useLatestDefined(listed.find((item) => importSourceKey(item) === state.slug));
	const schema = source?.inputSchema;

	const startRun = (values: SchemaFormValues) => {
		return Effect.runPromise(
			Effect.gen(function* () {
				if (source === undefined) {
					return;
				}
				setFailure(undefined);
				yield* startMutation
					.mutateEffect({
						source: source.reference,
						...toSchemaFormPayload(source.inputSchema, values),
					})
					.pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								props.onStarted();
								props.onClose();
							}),
						),
						Effect.catchCause((cause) =>
							Effect.sync(() => {
								const nextFailure = importStartFailure(t, Cause.squash(cause));
								setFailure(nextFailure);
								if (nextFailure.step !== undefined) {
									dispatch({ type: "recover-at", step: nextFailure.step });
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
					onRetry={props.onRetrySources}
					chooseLabel={(entry) => importSourceChooseLabel(t, entry)}
					toEntry={(item) => importSourceEntry(item, t, formatters, pluginNames)}
				/>
			</>
		)),
		Match.when("configure", () =>
			source === undefined ? null : (
				<form.Subscribe selector={(formState) => formState.values.fields}>
					{(values) => (
						<SelectedImportReadiness
							reference={source.reference}
							settings={toSchemaFormPayload(source.inputSchema, values)}
						>
							{() => (
								<ImportInputStep
									form={form}
									onBack={goBack}
									source={source}
									uploadFile={uploadFile}
									uploadAsset={uploadAsset}
									failureDetail={inputFailure}
									onContinue={() => void form.handleSubmit()}
								/>
							)}
						</SelectedImportReadiness>
					)}
				</form.Subscribe>
			),
		),
		Match.when("review", () =>
			source === undefined ? null : (
				<form.Subscribe selector={(formState) => formState.values.fields}>
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
			title={t(kernelMessage("client.imports.wizard.title"))}
			closeLabel={t(kernelMessage("client.imports.wizard.close"))}
			stepLabel={wizardStepLabel(state.step, WIZARD_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
