import { useRyotMutation } from "@ryot-app/client-sdk/react";
import { Button, FieldMessage, StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	SchemaForm,
	useSchemaForm,
	type SchemaFormApi,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import { Match, Result } from "effect";
import { useReducer, useState } from "react";

import {
	notificationChannelChooseLabel,
	notificationChannelEntry,
	notificationChannelList,
	type NotificationChannelDefinition,
} from "#/modules/notifications/channel-catalog";
import {
	createNotificationChannelBody,
	initialNotificationChannelFormValues,
} from "#/modules/notifications/payload";
import {
	INVALID_CHANNEL_DETAILS_MESSAGE,
	notificationChannelSaveFailure,
	type NotificationChannelSaveFailure,
} from "#/modules/notifications/save-failure";
import { createNotificationChannelMutation } from "#/modules/notifications/service";
import { CatalogPicker } from "#/modules/ui/catalog/picker";
import { findBySlug } from "#/modules/ui/catalog/selection";
import { schemaReviewRows } from "#/modules/ui/review-rows";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
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

export const NOTIFICATION_CHANNEL_WIZARD_TITLE = "Add a channel";

const stepHeadings = {
	pick: "Choose a channel",
	review: "Review and add",
	configure: "Provide the details",
} as const satisfies WizardStepHeadings;

/** The channel list is static, so only the ready-state copy is reachable. */
const pickerCopy = {
	emptyTitle: "No channels",
	searchLabel: "Search channels",
	loadingLabel: "Loading channels",
	errorTitle: "Unable to load channels",
	loadingDetail: "Loading the channels you can add...",
	emptyDetail: "No notification channels are available.",
	errorDetail: "The list of channels could not be loaded.",
};

function ConfigureStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly failureDetail: string | undefined;
	readonly definition: NotificationChannelDefinition;
}) {
	const uploadFile = useSchemaFileUpload();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 className="font-display text-lg font-semibold text-text">{props.definition.name}</h3>
				<p className="text-sm leading-6 text-text-muted">{props.definition.description}</p>
			</div>
			<SchemaForm
				form={props.form}
				icons={schemaFormIcons}
				uploadFile={uploadFile}
				onChange={() => undefined}
				schema={props.definition.schema}
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
	readonly onAdd: () => void;
	readonly onBack: () => void;
	readonly values: SchemaFormValues;
	readonly failureDetail: string | undefined;
	readonly definition: NotificationChannelDefinition;
}) {
	const rows = schemaReviewRows(props.definition.schema, props.values);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
						{props.definition.name}
					</span>
					<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
						{props.definition.badge}
					</span>
				</div>
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
			</div>
			<p className="text-sm leading-6 text-text-muted">
				Ryot sends notifications here as soon as the channel is added. Credentials are never shown
				again once saved.
			</p>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{props.failureDetail}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					onClick={props.onAdd}
					disabled={props.pending}
				>
					{props.pending ? "Adding..." : "Add channel"}
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

export function NotificationChannelCreateWizard(props: {
	readonly onClose: () => void;
	readonly smtpEnabled: boolean;
	readonly onCreated: () => void;
}) {
	const create = useRyotMutation(createNotificationChannelMutation);
	const [failure, setFailure] = useState<NotificationChannelSaveFailure | undefined>();
	const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
	const definition = findBySlug(notificationChannelList, state.slug);

	const add = async (values: SchemaFormValues) => {
		if (definition === undefined) {
			return;
		}
		const body = createNotificationChannelBody({ values, kind: definition.slug });
		if (Result.isFailure(body)) {
			setFailure({ step: "configure", detail: INVALID_CHANNEL_DETAILS_MESSAGE });
			dispatch({ step: "configure", type: "recover-at" });
			return;
		}
		setFailure(undefined);
		try {
			await create.mutateAsync(body.success);
		} catch (error) {
			const saveFailure = notificationChannelSaveFailure(error);
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

	const form = useSchemaForm({ onSubmit: requestReview, schemas: [definition?.schema] });

	useFormSeed(form, state.slug, () =>
		definition === undefined ? {} : initialNotificationChannelFormValues(definition.slug),
	);

	const goBack = () => {
		setFailure(undefined);
		dispatch({ type: "back" });
	};

	const chooseChannel = (slug: string) => {
		setFailure(undefined);
		dispatch({ slug, type: "picked" });
	};

	const reviewFailure = failure?.step === undefined ? failure?.detail : undefined;
	const configureFailure = failure?.step === "configure" ? failure.detail : undefined;
	const pickFailure = failure?.step === "pick" ? failure.detail : undefined;

	const stepBody = Match.value(state.step).pipe(
		Match.when("pick", () => (
			<>
				{pickFailure === undefined ? null : (
					<StatusMessage tone="error" className="text-sm">
						{pickFailure}
					</StatusMessage>
				)}
				<CatalogPicker
					copy={pickerCopy}
					onChoose={chooseChannel}
					chooseLabel={notificationChannelChooseLabel}
					state={{ status: "ready", sources: notificationChannelList }}
					toEntry={notificationChannelEntry({ smtpEnabled: props.smtpEnabled })}
				/>
			</>
		)),
		Match.when("configure", () =>
			definition === undefined ? null : (
				<ConfigureStep
					form={form}
					onBack={goBack}
					definition={definition}
					failureDetail={configureFailure}
					onContinue={() => void form.handleSubmit()}
				/>
			),
		),
		Match.when("review", () =>
			definition === undefined ? null : (
				<form.Subscribe selector={(formState) => formState.values}>
					{(values) => (
						<ReviewStep
							values={values}
							onBack={goBack}
							definition={definition}
							pending={create.isPending}
							failureDetail={reviewFailure}
							onAdd={() => void add(values)}
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
			title={NOTIFICATION_CHANNEL_WIZARD_TITLE}
			closeLabel="Close the notification channel wizard"
			stepLabel={wizardStepLabel(state.step, WIZARD_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
