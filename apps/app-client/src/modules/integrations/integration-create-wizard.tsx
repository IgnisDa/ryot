import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit, Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { Text } from "react-native";

import { temporaryFileUploadOperation } from "@/api/files/upload";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useTrackEvent } from "@/modules/analytics/state";
import { CatalogPicker } from "@/modules/ui/plugin-catalog/catalog-picker";
import { findBySlug } from "@/modules/ui/plugin-catalog/catalog-selection";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import type { SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";
import { WizardShell } from "@/modules/ui/wizard/wizard-shell";
import {
	createWizardState,
	WIZARD_STEPS,
	wizardReducer,
	wizardStepLabel,
	type WizardStepHeadings,
} from "@/modules/ui/wizard/wizard-state";

import {
	createIntegrationAtom,
	integrationProvidersAtom,
	integrationReactivityKeys,
} from "./atoms";
import { type IntegrationSaveFailure, integrationSaveFailure } from "./create-failure";
import { createIntegrationBody, initialIntegrationFormValues } from "./integration-payload";
import { IntegrationReviewStep } from "./integration-review-step";
import { IntegrationSettingsStep } from "./integration-settings-step";
import { integrationProviderChooseLabel, integrationProviderEntry } from "./provider-selection";
import { mapIntegrationProviderList } from "./state";

export const INTEGRATION_WIZARD_TITLE = "Connect a service";

const stepHeadings = {
	pick: "Choose a service",
	review: "Review and connect",
	configure: "Provide the details",
} as const satisfies WizardStepHeadings;

const pickerCopy = {
	emptyTitle: "No services yet",
	loadingLabel: "Loading services",
	errorSubject: "The list of services",
	errorTitle: "Unable to load services",
	loadingDetail: "Loading the services you can connect...",
	emptyDetail: "Once a plugin on this server contributes an integration, it shows up here.",
};

export function IntegrationCreateWizard(props: { readonly onClose: () => void }) {
	const scope = useApiScope();
	const providersAtom = integrationProvidersAtom(scope);
	const result = useAtomValue(providersAtom);
	const refreshProviders = useAtomRefresh(providersAtom);
	const trackEvent = useTrackEvent();
	const createIntegration = useAtomSet(createIntegrationAtom(scope), { mode: "promiseExit" });
	const [pending, setPending] = useState(false);
	const [saveCause, setSaveCause] = useState<unknown>();
	const [failure, setFailure] = useState<IntegrationSaveFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const providers = mapIntegrationProviderList(result);
	const listed = providers.status === "ready" ? providers.providers : [];
	const provider = findBySlug(listed, state.slug);
	const uploadFile = temporaryFileUploadOperation(scope);

	useInternalRequestFailureLogging(
		"integration providers query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging("integration creation failed", saveCause);

	const connect = useEffectEvent(async (values: SchemaFormValues) => {
		if (provider === undefined) {
			return;
		}
		setPending(true);
		setFailure(undefined);
		setSaveCause(undefined);
		const exit = await createIntegration({
			payload: createIntegrationBody({ provider, values }),
			reactivityKeys: integrationReactivityKeys(scope),
		});
		setPending(false);
		if (Exit.isFailure(exit)) {
			const mapped = integrationSaveFailure(exit.cause);
			setSaveCause(exit.cause);
			setFailure(mapped);
			if (mapped.step !== undefined) {
				dispatch({ type: "recover-at", step: mapped.step });
			}
			return;
		}
		trackEvent("Create Integration", { provider: provider.slug });
		props.onClose();
	});

	const requestReview = useEffectEvent(() => {
		setFailure(undefined);
		dispatch({ type: "review-requested" });
	});

	const form = useSchemaForm({
		onSubmit: requestReview,
		schemas: [provider?.commonSchema, provider?.settingsSchema],
	});

	const seedForm = useEffectEvent(() => {
		form.reset(provider === undefined ? {} : initialIntegrationFormValues(provider));
	});

	useEffect(() => {
		seedForm();
	}, [state.slug]);

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
					<Text accessibilityRole="alert" className="font-ui text-sm text-danger">
						{providerFailure}
					</Text>
				)}
				<CatalogPicker
					copy={pickerCopy}
					onChoose={chooseProvider}
					onRetry={refreshProviders}
					toEntry={integrationProviderEntry}
					chooseLabel={integrationProviderChooseLabel}
					state={
						providers.status === "ready"
							? { status: "ready", sources: providers.providers }
							: providers
					}
				/>
			</>
		)),
		Match.when("configure", () =>
			provider === undefined ? null : (
				<IntegrationSettingsStep
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
						<IntegrationReviewStep
							values={values}
							onBack={goBack}
							pending={pending}
							provider={provider}
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
