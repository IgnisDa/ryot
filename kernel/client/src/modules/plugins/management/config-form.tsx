import type { PluginConfigSchema } from "@ryot-app/contract/modules/plugins/manifest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Button } from "@ryot-app/plugin-ui-sdk";
import {
	initialSchemaFormValues,
	SchemaForm,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import type { ReactNode } from "react";

import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";

export function PluginConfigForm(props: {
	readonly seedKey: string;
	readonly pending: boolean;
	readonly submitLabel: string;
	readonly actions?: ReactNode;
	readonly pendingLabel: string;
	readonly submitClassName?: string;
	readonly schema: PluginConfigSchema;
	readonly stored?: Readonly<Record<string, JsonValue>>;
	readonly onSubmit: (config: Record<string, JsonValue>) => void;
}) {
	const uploadFile = useSchemaFileUpload();
	const mode = props.stored === undefined ? "create" : "edit";
	const initialValues = () => initialSchemaFormValues(props.schema, undefined, props.stored);
	const form = useSchemaForm({
		mode,
		schemas: [props.schema],
		onSubmit: (values) =>
			props.onSubmit(toSchemaFormPayload(props.schema, values, mode, initialValues())),
	});
	useFormSeed(form, props.seedKey, initialValues);
	const hasFields = Object.keys(props.schema.fields).length > 0;
	return (
		<form
			noValidate
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			{hasFields ? (
				<fieldset disabled={props.pending}>
					<SchemaForm
						mode={mode}
						form={form}
						onChange={() => {}}
						schema={props.schema}
						icons={schemaFormIcons}
						uploadFile={uploadFile}
					/>
				</fieldset>
			) : (
				<p className="text-sm text-text-muted">This plugin has no configuration.</p>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="submit"
					variant="primary"
					disabled={props.pending}
					className={props.submitClassName ?? "sm:px-6"}
				>
					{props.pending ? props.pendingLabel : props.submitLabel}
				</Button>
				{props.actions}
			</div>
		</form>
	);
}
