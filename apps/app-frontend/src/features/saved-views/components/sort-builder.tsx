import { Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import {
	buildDefaultSortFieldRow,
	type SavedViewExtendedFormValues,
	type SortFieldRow,
} from "../form-extended";
import { PropertyPathAutocomplete } from "./property-path-autocomplete";

type SortFieldMeta = {
	isValid: boolean;
	isDirty?: boolean;
	isBlurred?: boolean;
	errors: Array<{ message?: string } | undefined>;
};

type SortFieldsArrayField = {
	removeValue: (index: number) => void;
	pushValue: (value: SortFieldRow) => void;
	state: {
		meta: SortFieldMeta;
		value: SavedViewExtendedFormValues["sort"]["fields"];
	};
};

type SortFieldName =
	| "sort.fields"
	| "sort.direction"
	| `sort.fields[${number}].value`;

type SortBuilderFormLike = {
	AppField: <TName extends SortFieldName>(props: {
		name: TName;
		// biome-ignore lint/suspicious/noExplicitAny: TanStack Form field API has complex types
		children: (field: any) => ReactNode;
		mode?: TName extends "sort.fields" ? "array" : never;
	}) => ReactNode | Promise<ReactNode>;
};

function getErrorMessage(errors: Array<{ message?: string } | undefined>) {
	const messages = errors
		.map((error) => error?.message)
		.filter((message): message is string => Boolean(message));

	return messages.length > 0 ? messages.join(", ") : undefined;
}

type SortBuilderProps = {
	isLoading: boolean;
	form: SortBuilderFormLike;
	schemas: AppEntitySchema[];
};

export function SortBuilder(props: SortBuilderProps) {
	return (
		<Stack gap="sm">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Sort Configuration
				</Text>
				<Text c="dimmed" size="xs">
					Multiple sort fields enable COALESCE fallback for cross-schema views.
				</Text>
			</Stack>

			<props.form.AppField name="sort.direction">
				{(field) => (
					<field.SegmentedControlField
						fullWidth
						label="Direction"
						disabled={props.isLoading}
						data={[
							{ label: "Ascending", value: "asc" },
							{ label: "Descending", value: "desc" },
						]}
					/>
				)}
			</props.form.AppField>

			<props.form.AppField name="sort.fields" mode="array">
				{(fieldsArrayField) => {
					const arrayField = fieldsArrayField as SortFieldsArrayField;
					const fields = arrayField.state.value;
					const fieldsError = !arrayField.state.meta.isValid
						? getErrorMessage(arrayField.state.meta.errors)
						: undefined;

					return (
						<Stack gap="sm">
							<Text size="sm" fw={500}>
								Sort Fields
							</Text>

							{fields.map((field, index) => (
								<Paper key={field.id} p="sm" withBorder radius="md">
									<Group gap="sm" align="flex-end">
										<Box flex={1}>
											<props.form.AppField name={`sort.fields[${index}].value`}>
												{(valueField) => (
													<PropertyPathAutocomplete
														required
														excludeImage={false}
														schemas={props.schemas}
														disabled={props.isLoading}
														label={`Field ${index + 1}`}
														value={valueField.state.value}
														onBlur={valueField.handleBlur}
														error={!valueField.state.meta.isValid}
														onChange={(value) => valueField.handleChange(value)}
													/>
												)}
											</props.form.AppField>
										</Box>

										<Button
											size="sm"
											color="red"
											type="button"
											variant="subtle"
											onClick={() => arrayField.removeValue(index)}
											disabled={props.isLoading || fields.length === 1}
										>
											Remove
										</Button>
									</Group>
								</Paper>
							))}

							{fieldsError && (
								<Text c="red" size="xs">
									{fieldsError}
								</Text>
							)}

							<Button
								type="button"
								variant="light"
								disabled={props.isLoading}
								onClick={() => arrayField.pushValue(buildDefaultSortFieldRow())}
							>
								Add sort field
							</Button>
						</Stack>
					);
				}}
			</props.form.AppField>
		</Stack>
	);
}
