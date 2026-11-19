import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { renderSchemaAsset, useSchemaAssetUpload } from "@ryot-app/plugin-client-sdk/react";
import {
	initialSchemaFormValues,
	SchemaForm,
	type SchemaFormApi,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import type { CollectionHeaderResult } from "@ryot-app/ryotql-recipes/collections";

import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";

const emptyMembershipSchema: AppSchema = { fields: {} };

export const membershipSchema = (header: NonNullable<CollectionHeaderResult>) =>
	header.membershipPropertiesSchema ?? emptyMembershipSchema;

export const hasMembershipFields = (schema: AppSchema) => Object.keys(schema.fields).length > 0;

export function useMembershipForm(input: {
	readonly seedKey: string;
	readonly schema: AppSchema;
	readonly onSubmit: (properties: unknown) => void;
	readonly properties: Parameters<typeof initialSchemaFormValues>[2];
}) {
	const form = useSchemaForm({
		schemas: [input.schema],
		onSubmit: (values) => input.onSubmit(toSchemaFormPayload(input.schema, values)),
	});
	useFormSeed(form, input.seedKey, () =>
		initialSchemaFormValues(input.schema, undefined, input.properties),
	);
	return form;
}

export function MembershipFields(props: {
	readonly schema: AppSchema;
	readonly disabled: boolean;
	readonly form: SchemaFormApi;
}) {
	const uploadAsset = useSchemaAssetUpload();
	const uploadFile = useSchemaFileUpload();
	return (
		<fieldset disabled={props.disabled} className="min-w-0 border-0 p-0">
			<SchemaForm
				form={props.form}
				schema={props.schema}
				uploadFile={uploadFile}
				icons={schemaFormIcons}
				uploadAsset={uploadAsset}
				onChange={() => undefined}
				renderAsset={renderSchemaAsset}
				onReorder={schemaFormReorderFeedback}
			/>
		</fieldset>
	);
}
