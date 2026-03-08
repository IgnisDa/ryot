import {
	Button,
	Checkbox,
	Group,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import type { ReactNode } from "react";
import {
	buildDefaultPropertySchemaRow,
	type CreatePropertySchemaFormValues,
	type PropertySchemaType,
	propertySchemaTypes,
} from "./form";

type PropertySchemaFieldMeta = {
	isValid: boolean;
	isDirty?: boolean;
	isBlurred?: boolean;
	errors: Array<{ message?: string } | undefined>;
};

type PropertySchemaArrayField = {
	pushValue: (
		value: CreatePropertySchemaFormValues["properties"][number],
	) => void;
	removeValue: (index: number) => void;
	state: {
		meta: PropertySchemaFieldMeta;
		value: CreatePropertySchemaFormValues["properties"];
	};
};

type PropertySchemaValueField<TValue> = {
	handleBlur: () => void;
	handleChange: (value: TValue) => void;
	state: { value: TValue; meta: PropertySchemaFieldMeta };
};

type PropertySchemaFieldName =
	| "properties"
	| `properties[${number}].key`
	| `properties[${number}].type`
	| `properties[${number}].required`;

type PropertySchemaFormLike = {
	AppField: <TName extends PropertySchemaFieldName>(props: {
		name: TName;
		mode?: TName extends "properties" ? "array" : never;
		children: (field: unknown) => ReactNode;
	}) => ReactNode | Promise<ReactNode>;
};

function capitalizeFirst(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

const propertySchemaTypeOptions: Array<{
	label: string;
	value: PropertySchemaType;
}> = propertySchemaTypes.map((type) => ({
	value: type,
	label: capitalizeFirst(type),
}));

type PropertySchemasBuilderProps = {
	isLoading: boolean;
	description: string;
	placeholder: string;
	form: PropertySchemaFormLike;
};

function getErrorMessage(errors: Array<{ message?: string } | undefined>) {
	const messages = errors
		.map((error) => error?.message)
		.filter((message): message is string => Boolean(message));

	return messages.length > 0 ? messages.join(", ") : undefined;
}

export function PropertySchemasBuilder(props: PropertySchemasBuilderProps) {
	return (
		<props.form.AppField name="properties" mode="array">
			{(propertiesField) => {
				const arrayField = propertiesField as PropertySchemaArrayField;
				const properties = arrayField.state
					.value as CreatePropertySchemaFormValues["properties"];
				const propertiesError = !arrayField.state.meta.isValid
					? getErrorMessage(arrayField.state.meta.errors)
					: undefined;

				return (
					<Stack gap="sm">
						<Stack gap={2}>
							<Text fw={500} size="sm">
								Properties
							</Text>
							<Text c="dimmed" size="xs">
								{props.description}
							</Text>
						</Stack>

						{properties.map((property, index) => (
							<Paper key={property.id} p="sm" withBorder radius="md">
								<Stack gap="sm">
									<Group grow align="flex-start">
										<props.form.AppField name={`properties[${index}].key`}>
											{(keyField) => {
												const field =
													keyField as PropertySchemaValueField<string>;
												const keyValue = field.state.value;
												const keyError =
													getErrorMessage(field.state.meta.errors) ??
													(keyValue.trim().length === 0 &&
													(field.state.meta.isBlurred ||
														field.state.meta.isDirty)
														? "Key is required"
														: undefined);

												return (
													<TextInput
														required
														label="Key"
														value={keyValue}
														error={keyError}
														onBlur={field.handleBlur}
														disabled={props.isLoading}
														placeholder={props.placeholder}
														onChange={(event) =>
															field.handleChange(event.currentTarget.value)
														}
													/>
												);
											}}
										</props.form.AppField>

										<props.form.AppField name={`properties[${index}].type`}>
											{(typeField) => {
												const field =
													typeField as PropertySchemaValueField<PropertySchemaType>;
												const typeValue = field.state.value;

												return (
													<Select
														required
														label="Type"
														value={typeValue}
														onBlur={field.handleBlur}
														disabled={props.isLoading}
														data={propertySchemaTypeOptions}
														onChange={(value) =>
															field.handleChange(
																(value ?? "string") as PropertySchemaType,
															)
														}
													/>
												);
											}}
										</props.form.AppField>
									</Group>

									<Group justify="space-between" align="center">
										<props.form.AppField name={`properties[${index}].required`}>
											{(requiredField) => {
												const field =
													requiredField as PropertySchemaValueField<boolean>;
												const requiredValue = field.state.value;

												return (
													<Checkbox
														label="Required"
														checked={requiredValue}
														onBlur={field.handleBlur}
														disabled={props.isLoading}
														onChange={(event) =>
															field.handleChange(event.currentTarget.checked)
														}
													/>
												);
											}}
										</props.form.AppField>

										<Button
											size="xs"
											color="red"
											type="button"
											variant="subtle"
											disabled={props.isLoading}
											onClick={() => arrayField.removeValue(index)}
										>
											Remove
										</Button>
									</Group>
								</Stack>
							</Paper>
						))}

						{propertiesError && (
							<Text c="red" size="xs">
								{propertiesError}
							</Text>
						)}

						<Button
							type="button"
							variant="light"
							disabled={props.isLoading}
							onClick={() =>
								arrayField.pushValue(buildDefaultPropertySchemaRow())
							}
						>
							Add property
						</Button>
					</Stack>
				);
			}}
		</props.form.AppField>
	);
}
