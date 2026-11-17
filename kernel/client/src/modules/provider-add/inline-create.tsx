import {
	type EntityEditorSaveOutput,
	type EntityEditorSaveRequest,
	type EntityEditorSaveSubmission,
	retryableEntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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

type CreateStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "saving" }
	| { readonly kind: "error"; readonly message: Text };

export function InlineEntityCreate(props: {
	readonly onBack: () => void;
	readonly initialName: string;
	readonly uploadFile: SchemaFileUpload;
	readonly schema: EntitySchemaReference;
	readonly uploadAsset: SchemaAssetUpload;
	readonly renderAsset: SchemaAssetRenderer;
	readonly onCreated: (entityId: EntityId) => void;
	readonly definition: { readonly name: Message; readonly propertiesSchema: AppSchema };
	readonly create: (
		request: EntityEditorSaveRequest,
	) => Effect.Effect<EntityEditorSaveOutput, ProviderAddLoadError>;
}) {
	const t = useT();
	const definitionName = t(props.definition.name);
	const propertiesSchema = props.definition.propertiesSchema;
	const [name, setName] = useState(props.initialName);
	const [nameError, setNameError] = useState<string>();
	const [status, setStatus] = useState<CreateStatus>({ kind: "idle" });
	const attempt = useRef<undefined | EntityEditorSaveRequest>(undefined);

	const submit = (values: SchemaFormValues) => {
		if (name.trim() === "") {
			setNameError(t(kernelMessage("sdk.entity-editor.name-required")));
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
							reason: kernelMessage("client.provider-add.create.failed"),
						})),
					);
				if (output.kind === "saved") {
					props.onCreated(output.entityId);
					return;
				}
				setStatus({
					kind: "error",
					message:
						output.kind === "invalid"
							? t(output.reason)
							: t(kernelMessage("client.provider-add.create.failed")),
				});
			}),
		);
	};

	const form = useSchemaForm({ onSubmit: submit, schemas: [propertiesSchema] });
	useFormSeed(form, "inline-create", () => initialSchemaFormValues(propertiesSchema));

	return (
		<ActionForm
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={() => void form.handleSubmit()}
			label={t(kernelMessage("client.provider-add.create.new", { name: definitionName }))}
		>
			<div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
				<h2 className="text-base font-semibold text-text">
					{t(kernelMessage("client.provider-add.create.new", { name: definitionName }))}
				</h2>
				<Field error={nameError} label={t(kernelMessage("client.provider-add.create.name"))}>
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
					{t(kernelMessage("common.action.back"))}
				</Button>
				<Button loading={status.kind === "saving"} onClick={() => void form.handleSubmit()}>
					{t(kernelMessage("client.provider-add.create.submit"))}
				</Button>
			</div>
		</ActionForm>
	);
}
