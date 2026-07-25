import { useRyot } from "@ryot-app/client-sdk/react";
import { Button, FieldMessage, Modal, StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	useSchemaForm,
	type SchemaFileUpload,
	type SchemaFormApi,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import type { ListedIntegrationProvider } from "@ryot-app/contract/modules/integrations/schemas";
import { useRouteContext } from "@tanstack/react-router";
import { Effect, Match } from "effect";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

import { IntegrationsApi } from "#/api/integrations";
import {
	IntegrationCatalogPicker,
	type CatalogPickerState,
} from "#/modules/integrations/catalog-picker";
import {
	createIntegrationBody,
	initialIntegrationFormValues,
} from "#/modules/integrations/payload";
import {
	findProviderBySlug,
	integrationLotDetail,
	integrationLotLabel,
} from "#/modules/integrations/provider-selection";
import { schemaReviewRows } from "#/modules/integrations/review-rows";
import {
	integrationSaveFailure,
	type IntegrationSaveFailure,
} from "#/modules/integrations/save-failure";
import { IntegrationSettingsForm } from "#/modules/integrations/settings-form";
import {
	createWizardState,
	wizardReducer,
	wizardStepLabel,
} from "#/modules/integrations/wizard-state";
import { AppIcon } from "#/modules/navigation/app-icon";

export const INTEGRATION_WIZARD_TITLE = "Connect a service";

const UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

type CreateWizardProps = {
	readonly onClose: () => void;
	readonly onCreated: () => void;
	readonly onRetryProviders: () => void;
	readonly providers: CatalogPickerState;
};

function SettingsStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly failureDetail: string | undefined;
	readonly provider: ListedIntegrationProvider;
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
				<Button type="button" variant="primary" onClick={props.onContinue} className="sm:px-6">
					Continue
				</Button>
				<Button type="button" variant="secondary" onClick={props.onBack} className="sm:px-6">
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
	readonly provider: ListedIntegrationProvider;
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
	const ryot = useRyot();
	const { runtime, scope } = useRouteContext({ from: "/_authenticated" });
	const controller = useRef(new AbortController());
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<IntegrationSaveFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const listed = props.providers.status === "ready" ? props.providers.providers : [];
	const provider = findProviderBySlug(listed, state.slug);

	useEffect(() => () => controller.current.abort(), []);

	const uploadFile: SchemaFileUpload = async (request) => {
		try {
			const uploaded = await ryot.uploads.uploadTemporary(request);
			return { kind: "uploaded", token: uploaded.token };
		} catch {
			return { kind: "failed", message: UPLOAD_FAILURE_MESSAGE };
		}
	};

	const connect = useEffectEvent(async (values: SchemaFormValues) => {
		if (provider === undefined) {
			return;
		}
		setPending(true);
		setFailure(undefined);
		const outcome = await runtime.runPromise(
			Effect.flatMap(IntegrationsApi, (api) =>
				api.create(scope, { payload: createIntegrationBody({ provider, values }) }),
			).pipe(
				Effect.match({
					onSuccess: () => ({ failure: undefined }),
					onFailure: (error) => ({ failure: integrationSaveFailure(error) }),
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
		props.onCreated();
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
					<StatusMessage tone="error" className="text-sm">
						{providerFailure}
					</StatusMessage>
				)}
				<IntegrationCatalogPicker
					state={props.providers}
					onChoose={chooseProvider}
					onRetry={props.onRetryProviders}
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
		<Modal
			onClose={props.onClose}
			closeLabel="Close"
			label={INTEGRATION_WIZARD_TITLE}
			containerClassName="md:items-center md:justify-center md:p-6"
			className="flex w-full flex-1 flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card md:pt-0"
		>
			<div className="flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3">
				<div className="flex items-center justify-between gap-3">
					<h2 className="font-display text-xl font-semibold text-text">
						{INTEGRATION_WIZARD_TITLE}
					</h2>
					<button
						type="button"
						className="p-1 text-text-muted"
						onClick={props.onClose}
						aria-label="Close the integration wizard"
					>
						<AppIcon size={20} name="x" />
					</button>
				</div>
				<p className="text-xs text-text-subtle">{wizardStepLabel(state.step)}</p>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex flex-col gap-4 p-4">{stepBody}</div>
			</div>
		</Modal>
	);
}
