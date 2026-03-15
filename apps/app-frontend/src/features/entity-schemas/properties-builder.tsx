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
import {
	buildDefaultEntitySchemaPropertyRow,
	type CreateEntitySchemaFormValues,
	type EntitySchemaPropertyType,
	entitySchemaPropertyTypes,
} from "./form";

function capitalizeFirst(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

const entitySchemaPropertyTypeOptions: Array<{
	label: string;
	value: EntitySchemaPropertyType;
}> = entitySchemaPropertyTypes.map((type) => ({
	value: type,
	label: capitalizeFirst(type),
}));

type EntitySchemaPropertiesBuilderProps = {
	form: any;
	isLoading: boolean;
};

function getErrorMessage(errors: Array<{ message?: string } | undefined>) {
	const messages = errors
		.map((error) => error?.message)
		.filter((message): message is string => Boolean(message));

	return messages.length > 0 ? messages.join(", ") : undefined;
}

export function EntitySchemaPropertiesBuilder(
	props: EntitySchemaPropertiesBuilderProps,
) {
	return (
		<props.form.AppField name="properties" mode="array">
			{(propertiesField: any) => {
				const properties = propertiesField.state
					.value as CreateEntitySchemaFormValues["properties"];
				const propertiesError = !propertiesField.state.meta.isValid
					? getErrorMessage(propertiesField.state.meta.errors)
					: undefined;

				return (
					<Stack gap="sm">
						<Stack gap={2}>
							<Text fw={500} size="sm">
								Properties
							</Text>
							<Text c="dimmed" size="xs">
								Add each tracked property as a typed field.
							</Text>
						</Stack>

						{properties.map((_, index) => (
							<Paper key={index} p="sm" withBorder radius="md">
								<Stack gap="sm">
									<Group grow align="flex-start">
										<props.form.AppField name={`properties[${index}].key`}>
											{(keyField: any) => {
												const keyValue = keyField.state.value as string;
												const keyError =
													getErrorMessage(keyField.state.meta.errors) ??
													(keyValue.trim().length === 0 &&
													(keyField.state.meta.isBlurred ||
														keyField.state.meta.isDirty)
														? "Key is required"
														: undefined);

												return (
													<TextInput
														required
														label="Key"
														value={keyValue}
														error={keyError}
														placeholder="title"
														disabled={props.isLoading}
														onBlur={keyField.handleBlur}
														onChange={(event) =>
															keyField.handleChange(event.currentTarget.value)
														}
													/>
												);
											}}
										</props.form.AppField>

										<props.form.AppField name={`properties[${index}].type`}>
											{(typeField: any) => {
												const typeValue = typeField.state
													.value as EntitySchemaPropertyType;

												return (
													<Select
														required
														label="Type"
														value={typeValue}
														disabled={props.isLoading}
														onBlur={typeField.handleBlur}
														data={entitySchemaPropertyTypeOptions}
														onChange={(value) =>
															typeField.handleChange(
																(value ?? "string") as EntitySchemaPropertyType,
															)
														}
													/>
												);
											}}
										</props.form.AppField>
									</Group>

									<Group justify="space-between" align="center">
										<props.form.AppField name={`properties[${index}].required`}>
											{(requiredField: any) => {
												const requiredValue = requiredField.state
													.value as boolean;

												return (
													<Checkbox
														label="Required"
														checked={requiredValue}
														disabled={props.isLoading}
														onBlur={requiredField.handleBlur}
														onChange={(event) =>
															requiredField.handleChange(
																event.currentTarget.checked,
															)
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
											onClick={() => propertiesField.removeValue(index)}
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
								propertiesField.pushValue(buildDefaultEntitySchemaPropertyRow())
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
