import { useRyot } from "@ryot-app/client-sdk/react";
import { StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	initialSchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
	type SchemaFileUpload,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import type { ListedImportSource } from "@ryot-app/contract/modules/imports/schemas";
import { useRouteContext } from "@tanstack/react-router";
import { Effect, Match } from "effect";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

import { ImportsApi } from "#/api/imports";
import { ImportInputStep } from "#/modules/imports/input-step";
import { ImportReviewStep } from "#/modules/imports/review-step";
import { importSourceChooseLabel, importSourceEntry } from "#/modules/imports/source-selection";
import { importStartFailure, type ImportStartFailure } from "#/modules/imports/start-failure";
import { CatalogPicker, type CatalogPickerState } from "#/modules/ui/catalog/picker";
import { findBySlug } from "#/modules/ui/catalog/selection";
import { WizardShell } from "#/modules/ui/wizard/wizard-shell";
import {
	createWizardState,
	wizardReducer,
	wizardStepLabel,
	type WizardStepHeadings,
} from "#/modules/ui/wizard/wizard-state";

export const IMPORT_WIZARD_TITLE = "Start an import";

export type ImportSourcePickerState = CatalogPickerState<ListedImportSource>;

const UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

const stepHeadings = {
	pick: "Choose a service",
	review: "Review and start",
	configure: "Provide the details",
} as const satisfies WizardStepHeadings;

const pickerCopy = {
	emptyTitle: "No services yet",
	loadingLabel: "Loading services",
	errorTitle: "Unable to load services",
	loadingDetail: "Loading the services you can import from...",
	errorDetail: "The list of services could not be loaded. Check the server and try again.",
	emptyDetail: "Once a plugin on this server contributes an importer, it shows up here.",
};

export function ImportStartWizard(props: {
	readonly onClose: () => void;
	readonly onStarted: () => void;
	readonly onRetrySources: () => void;
	readonly sources: ImportSourcePickerState;
}) {
	const ryot = useRyot();
	const { runtime, scope } = useRouteContext({ from: "/_authenticated" });
	const controller = useRef(new AbortController());
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<ImportStartFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const listed = props.sources.status === "ready" ? props.sources.sources : [];
	const source = findBySlug(listed, state.slug);
	const schema = source?.inputSchema;

	useEffect(() => () => controller.current.abort(), []);

	const uploadFile: SchemaFileUpload = async (request) => {
		try {
			const uploaded = await ryot.uploads.uploadTemporary(request);
			return { kind: "uploaded", token: uploaded.token };
		} catch {
			return { kind: "failed", message: UPLOAD_FAILURE_MESSAGE };
		}
	};

	const startRun = useEffectEvent(async (values: SchemaFormValues) => {
		if (source === undefined) {
			return;
		}
		setPending(true);
		setFailure(undefined);
		const outcome = await runtime.runPromise(
			Effect.flatMap(ImportsApi, (api) =>
				api.createRun(scope, {
					payload: {
						source: source.slug,
						...toSchemaFormPayload(source.inputSchema, values),
					},
				}),
			).pipe(
				Effect.match({
					onSuccess: () => ({ failure: undefined }),
					onFailure: (error) => ({ failure: importStartFailure(error) }),
				}),
			),
			{ signal: controller.current.signal },
		);
		setPending(false);
		if (outcome.failure !== undefined) {
			setFailure(outcome.failure);
			if (outcome.failure.step !== undefined) {
				dispatch({ type: "recover-at", step: outcome.failure.step });
			}
			return;
		}
		props.onStarted();
		props.onClose();
	});

	const requestReview = useEffectEvent(() => {
		setFailure(undefined);
		dispatch({ type: "review-requested" });
	});

	const form = useSchemaForm({ schemas: [schema], onSubmit: requestReview });

	const seedForm = useEffectEvent(() => {
		form.reset(schema === undefined ? {} : initialSchemaFormValues(schema));
	});

	useEffect(() => {
		seedForm();
	}, [state.slug]);

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
							pending={pending}
							failureDetail={reviewFailure}
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
			stepLabel={wizardStepLabel(state.step, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
