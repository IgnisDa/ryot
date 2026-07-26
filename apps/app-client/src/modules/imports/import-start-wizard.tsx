import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit, Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { Text } from "react-native";

import { temporaryFileUploadOperation } from "@/api/files/upload";
import { requestFailureMessage } from "@/api/request-failure";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { openExternalLink } from "@/modules/ui/external-link";
import { CatalogPicker } from "@/modules/ui/plugin-catalog/catalog-picker";
import { findBySlug } from "@/modules/ui/plugin-catalog/catalog-selection";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import {
	initialSchemaFormValues,
	type SchemaFormValues,
	toSchemaFormPayload,
} from "@/modules/ui/schema-form/schema-form-state";
import { WizardShell } from "@/modules/ui/wizard/wizard-shell";
import {
	createWizardState,
	WIZARD_STEPS,
	wizardReducer,
	wizardStepLabel,
	type WizardStepHeadings,
} from "@/modules/ui/wizard/wizard-state";

import { createImportRunAtom, importRunReactivityKeys, importSourcesAtom } from "./atoms";
import { ImportInputStep } from "./import-input-step";
import { ImportReviewStep } from "./import-review-step";
import { importSourceChooseLabel, importSourceEntry } from "./source-selection";
import { type ImportStartFailure, importStartFailure } from "./start-failure";
import { mapImportSourceList } from "./state";

export const IMPORT_WIZARD_TITLE = "Start an import";

const stepHeadings = {
	pick: "Choose a service",
	review: "Review and start",
	configure: "Provide the details",
} as const satisfies WizardStepHeadings;

const pickerCopy = {
	emptyTitle: "No services yet",
	loadingLabel: "Loading services",
	errorSubject: "The list of services",
	errorTitle: "Unable to load services",
	loadingDetail: "Loading the services you can import from...",
	emptyDetail: "Once a plugin on this server contributes an importer, it shows up here.",
};

export function ImportStartWizard(props: { readonly onClose: () => void }) {
	const scope = useApiScope();
	const sourcesAtom = importSourcesAtom(scope);
	const result = useAtomValue(sourcesAtom);
	const refreshSources = useAtomRefresh(sourcesAtom);
	const createRun = useAtomSet(createImportRunAtom(scope), { mode: "promiseExit" });
	const [pending, setPending] = useState(false);
	const [startCause, setStartCause] = useState<unknown>();
	const [failure, setFailure] = useState<ImportStartFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const sources = mapImportSourceList(result);
	const listed = sources.status === "ready" ? sources.sources : [];
	const source = findBySlug(listed, state.slug);
	const schema = source?.inputSchema;
	const uploadFile = temporaryFileUploadOperation(scope);

	useInternalRequestFailureLogging(
		"import sources query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging("import run creation failed", startCause);

	const startRun = useEffectEvent(async (values: SchemaFormValues) => {
		if (source === undefined) {
			return;
		}
		setPending(true);
		setFailure(undefined);
		setStartCause(undefined);
		const exit = await createRun({
			payload: { source: source.slug, ...toSchemaFormPayload(source.inputSchema, values) },
			reactivityKeys: importRunReactivityKeys(scope),
		});
		setPending(false);
		if (Exit.isFailure(exit)) {
			const mapped = importStartFailure(requestFailureMessage(exit.cause));
			setStartCause(exit.cause);
			setFailure(mapped);
			if (mapped.step !== undefined) {
				dispatch({ type: "recover-at", step: mapped.step });
			}
			return;
		}
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
					<Text accessibilityRole="alert" className="font-ui text-sm text-danger">
						{sourceFailure}
					</Text>
				)}
				<CatalogPicker
					copy={pickerCopy}
					onChoose={chooseSource}
					onRetry={refreshSources}
					toEntry={importSourceEntry}
					chooseLabel={importSourceChooseLabel}
					state={
						sources.status === "ready" ? { status: "ready", sources: sources.sources } : sources
					}
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
					openLink={openExternalLink}
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
			stepLabel={wizardStepLabel(state.step, WIZARD_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
