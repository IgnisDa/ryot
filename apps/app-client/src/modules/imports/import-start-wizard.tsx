import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit, Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { temporaryFileUploadOperation } from "@/api/uploads";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { AppIcon } from "@/modules/icons";
import { openExternalLink } from "@/modules/ui/external-link";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import {
	initialSchemaFormValues,
	type SchemaFormValues,
	toSchemaFormPayload,
} from "@/modules/ui/schema-form/schema-form-state";

import { createImportRunAtom, importRunReactivityKeys, importSourcesAtom } from "./atoms";
import { ImportInputStep } from "./import-input-step";
import { ImportReviewStep } from "./import-review-step";
import { ImportSourcePicker } from "./import-source-picker";
import { findImportSource } from "./source-selection";
import {
	type ImportStartFailure,
	importStartFailure,
	importStartFailureMessage,
} from "./start-failure";
import {
	createImportWizardState,
	importWizardReducer,
	importWizardStepLabel,
} from "./start-wizard-state";
import { mapImportSourceList } from "./state";

export const IMPORT_WIZARD_TITLE = "Start an import";

export function ImportStartWizard(props: { readonly onClose: () => void }) {
	const scope = useApiScope();
	const sourcesAtom = importSourcesAtom(scope);
	const result = useAtomValue(sourcesAtom);
	const refreshSources = useAtomRefresh(sourcesAtom);
	const createRun = useAtomSet(createImportRunAtom(scope), { mode: "promiseExit" });
	const [pending, setPending] = useState(false);
	const [startCause, setStartCause] = useState<unknown>();
	const [failure, setFailure] = useState<ImportStartFailure | undefined>();
	const [state, dispatch] = useReducer(importWizardReducer, undefined, createImportWizardState);
	const sources = mapImportSourceList(result);
	const listed = sources.status === "ready" ? sources.sources : [];
	const source = findImportSource(listed, state.sourceSlug);
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
			const mapped = importStartFailure(importStartFailureMessage(exit.cause));
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

	const form = useSchemaForm({ schema, onSubmit: requestReview });

	const seedForm = useEffectEvent(() => {
		form.reset(schema === undefined ? {} : initialSchemaFormValues(schema));
	});

	useEffect(() => {
		seedForm();
	}, [state.sourceSlug]);

	const goBack = () => {
		setFailure(undefined);
		dispatch({ type: "back" });
	};

	const chooseSource = (slug: string) => {
		setFailure(undefined);
		dispatch({ slug, type: "source-chosen" });
	};

	const inputFailure = failure?.step === "input" ? failure.detail : undefined;
	const reviewFailure = failure?.step === undefined ? failure?.detail : undefined;
	const sourceFailure = failure?.step === "source" ? failure.detail : undefined;

	const stepBody = Match.value(state.step).pipe(
		Match.when("source", () => (
			<>
				{sourceFailure === undefined ? null : (
					<Text accessibilityRole="alert" className="font-ui text-sm text-danger">
						{sourceFailure}
					</Text>
				)}
				<ImportSourcePicker state={sources} onChoose={chooseSource} onRetry={refreshSources} />
			</>
		)),
		Match.when("input", () =>
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
		<View className="flex-1">
			<View className="gap-1 border-b border-border px-4 py-3">
				<View className="flex-row items-center justify-between gap-3">
					<Text accessibilityRole="header" className="font-display-semibold text-xl text-text">
						{IMPORT_WIZARD_TITLE}
					</Text>
					<Pressable
						className="p-1"
						onPress={props.onClose}
						accessibilityRole="button"
						accessibilityLabel="Close the import wizard"
					>
						<AppIcon size={20} name="x" className="text-text-muted" />
					</Pressable>
				</View>
				<Text className="font-ui text-xs text-text-subtle">
					{importWizardStepLabel(state.step)}
				</Text>
			</View>
			<ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
				<View className="gap-4 p-4">{stepBody}</View>
			</ScrollView>
		</View>
	);
}
