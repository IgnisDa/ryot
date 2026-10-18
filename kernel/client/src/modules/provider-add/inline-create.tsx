import {
	type EntityEditorSaveOutput,
	type EntityEditorSaveRequest,
	type EntityEditorSaveSubmission,
	retryableEntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { ActionForm, Button, Field, StatusMessage, TextField } from "@ryot-app/plugin-ui-sdk";
import {
	initialSchemaFormValues,
	type SchemaAssetRenderer,
	type SchemaAssetUpload,
	type SchemaFileUpload,
	SchemaForm,
	type SchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";
import { useRef, useState } from "react";

import { schemaFormIcons } from "#/modules/provider-add/panel";
import type { ProviderAddLoadError } from "#/modules/provider-add/service";
import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { useFormSeed } from "#/modules/ui/use-form-seed";

const CREATE_FAILED_MESSAGE = "Could not create this item. Try again.";

type CreateStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "saving" }
	| { readonly kind: "error"; readonly message: string };

export function InlineEntityCreate(props: {
	readonly initialName: string;
	readonly schema: EntitySchemaReference;
	readonly definition: { readonly name: string; readonly propertiesSchema: AppSchema };
	readonly uploadFile: SchemaFileUpload;
	readonly uploadAsset: SchemaAssetUpload;
	readonly renderAsset: SchemaAssetRenderer;
	readonly onBack: () => void;
	readonly onCreated: (entityId: EntityId) => void;
	readonly create: (
		request: EntityEditorSaveRequest,
	) => Effect.Effect<EntityEditorSaveOutput, ProviderAddLoadError>;
}) {
	const propertiesSchema = props.definition.propertiesSchema;
	const [name, setName] = useState(props.initialName);
	const [nameError, setNameError] = useState<string>();
	const [status, setStatus] = useState<CreateStatus>({ kind: "idle" });
	const attempt = useRef<EntityEditorSaveRequest | undefined>(undefined);

	const submit = (values: SchemaFormValues) => {
		if (name.trim() === "") {
			setNameError("Enter a name");
			return;
		}
		setNameError(undefined);
		setStatus({ kind: "saving" });
		const submission: EntityEditorSaveSubmission = {
			action: "save",
			name: name.trim(),
			relationships: [],
			target: { kind: "create" },
			entitySchema: props.schema,
			properties: toSchemaFormPayload(propertiesSchema, values),
		};
		const request = retryableEntityEditorSaveRequest(attempt.current, submission, new Date());
		attempt.current = request;
		void Effect.runPromise(
			Effect.gen(function* () {
				const output = yield* props
					.create(request)
					.pipe(
						Effect.orElseSucceed((): EntityEditorSaveOutput => ({
							kind: "invalid",
							message: CREATE_FAILED_MESSAGE,
						})),
					);
				if (output.kind === "saved") {
					props.onCreated(output.entityId);
					return;
				}
				setStatus({
					kind: "error",
					message: output.kind === "invalid" ? output.message : CREATE_FAILED_MESSAGE,
				});
			}),
		);
	};

	const form = useSchemaForm({ onSubmit: submit, schemas: [propertiesSchema] });
	useFormSeed(form, "inline-create", () => initialSchemaFormValues(propertiesSchema));

	return (
		<ActionForm
			label={`New ${props.definition.name}`}
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={() => void form.handleSubmit()}
		>
			<div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
				<h2 className="text-base font-semibold text-text">New {props.definition.name}</h2>
				<Field label="Name" error={nameError}>
					{(control) => (
						<TextField
							{...control}
							autoFocus
							value={name}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
					)}
				</Field>
				<SchemaForm
					form={form}
					icons={schemaFormIcons}
					schema={propertiesSchema}
					onChange={() => undefined}
					uploadFile={props.uploadFile}
					uploadAsset={props.uploadAsset}
					renderAsset={props.renderAsset}
					onReorder={schemaFormReorderFeedback}
				/>
				{status.kind === "error" ? (
					<StatusMessage tone="error">{status.message}</StatusMessage>
				) : null}
			</div>
			<div className="flex justify-end gap-2 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
				<Button variant="ghost" onClick={props.onBack} disabled={status.kind === "saving"}>
					Back
				</Button>
				<Button loading={status.kind === "saving"} onClick={() => void form.handleSubmit()}>
					Create
				</Button>
			</div>
		</ActionForm>
	);
}
