import {
	Button,
	Group,
	Paper,
	SegmentedControl,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import type { ReactNode } from "react";
import {
	buildDefaultSortFieldRow,
	type SavedViewExtendedFormValues,
	type SortFieldRow,
} from "../form-extended";

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

type SortDirectionField = {
	handleBlur: () => void;
	handleChange: (value: "asc" | "desc") => void;
	state: { meta: SortFieldMeta; value: "asc" | "desc" };
};

type SortFieldValueField = {
	handleBlur: () => void;
	handleChange: (value: string) => void;
	state: { value: string; meta: SortFieldMeta };
};

type SortFieldName =
	| "sort.fields"
	| "sort.direction"
	| `sort.fields[${number}].value`;

type SortBuilderFormLike = {
	AppField: <TName extends SortFieldName>(props: {
		name: TName;
		children: (field: unknown) => ReactNode;
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
};

export function SortBuilder(props: SortBuilderProps) {
	return (
		<Stack gap="sm">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Sort Configuration
				</Text>
				<Text c="dimmed" size="xs">
					Configure how entities are sorted. Use{" "}
					<Text span c="gray.7" ff="var(--font-family-monospace)">
						@name
					</Text>{" "}
					for cross-schema properties or{" "}
					<Text span c="gray.7" ff="var(--font-family-monospace)">
						schema.property
					</Text>{" "}
					for schema-specific fields.
				</Text>
			</Stack>

			<props.form.AppField name="sort.direction">
				{(directionField) => {
					const field = directionField as SortDirectionField;
					const directionValue = field.state.value;

					return (
						<Stack gap={4}>
							<Text size="sm" fw={500}>
								Direction
							</Text>
							<SegmentedControl
								fullWidth
								value={directionValue}
								disabled={props.isLoading}
								onChange={(value) =>
									field.handleChange(value as "asc" | "desc")
								}
								data={[
									{ label: "Ascending", value: "asc" },
									{ label: "Descending", value: "desc" },
								]}
							/>
						</Stack>
					);
				}}
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
							<Stack gap={4}>
								<Text size="sm" fw={500}>
									Sort Fields
								</Text>
								<Text c="dimmed" size="xs">
									Multiple fields enable COALESCE fallback for cross-schema
									views
								</Text>
							</Stack>

							{fields.map((field, index) => (
								<Paper key={field.id} p="sm" withBorder radius="md">
									<Group gap="sm" align="flex-end">
										<props.form.AppField name={`sort.fields[${index}].value`}>
											{(fieldValueField) => {
												const valueField =
													fieldValueField as SortFieldValueField;
												const fieldValue = valueField.state.value;
												const fieldError = getErrorMessage(
													valueField.state.meta.errors,
												);

												return (
													<TextInput
														required
														flex={1}
														value={fieldValue}
														error={fieldError}
														disabled={props.isLoading}
														label={`Field ${index + 1}`}
														onBlur={valueField.handleBlur}
														placeholder="e.g., @name or smartphones.year"
														onChange={(event) =>
															valueField.handleChange(event.currentTarget.value)
														}
													/>
												);
											}}
										</props.form.AppField>

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
