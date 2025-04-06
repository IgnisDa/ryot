import { Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

type DisplayConfigSection = "grid" | "list";
type DisplayConfigProperty =
	| "imageProperty"
	| "titleProperty"
	| "badgeProperty"
	| "subtitleProperty";

export type DisplayConfigPropertyArrayName =
	| `displayConfiguration.${DisplayConfigSection}.${DisplayConfigProperty}`
	| `displayConfiguration.table.columns[${number}].property`;

export type DisplayConfigPropertyFieldName =
	| DisplayConfigPropertyArrayName
	| "displayConfiguration.table.columns"
	| `displayConfiguration.${DisplayConfigSection}.${DisplayConfigProperty}[${number}].value`
	| `displayConfiguration.table.columns[${number}].label`
	| `displayConfiguration.table.columns[${number}].property[${number}].value`;

type PropertyPathRow = {
	id: string;
	value: string;
};

type PropertyArrayFieldMeta = {
	isValid: boolean;
	isDirty?: boolean;
	isBlurred?: boolean;
	errors: Array<{ message?: string } | undefined>;
};

type PropertyArrayField = {
	removeValue: (index: number) => void;
	pushValue: (value: PropertyPathRow) => void;
	state: {
		meta: PropertyArrayFieldMeta;
		value: PropertyPathRow[] | null | undefined;
	};
};

export type DisplayConfigBuilderFormLike = {
	AppField: <TName extends DisplayConfigPropertyFieldName>(props: {
		name: TName;
		// biome-ignore lint/suspicious/noExplicitAny: TanStack Form field API has complex types
		children: (field: any) => ReactNode;
		mode?: TName extends
			| DisplayConfigPropertyArrayName
			| "displayConfiguration.table.columns"
			? "array"
			: never;
	}) => ReactNode | Promise<ReactNode>;
};

export function PropertyArrayEditor(props: {
	label: string;
	isLoading: boolean;
	description: string;
	emptyLabel?: string;
	buttonLabel?: string;
	notConfiguredLabel?: string;
	form: DisplayConfigBuilderFormLike;
	buildNewRow: () => PropertyPathRow;
	name: DisplayConfigPropertyArrayName;
}) {
	return (
		<Stack gap="sm">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					{props.label}
				</Text>
				<Text c="dimmed" size="xs">
					{props.description}
				</Text>
			</Stack>

			<props.form.AppField name={props.name} mode="array">
				{(arrayFieldRaw) => {
					const arrayField = arrayFieldRaw as PropertyArrayField;
					const properties = arrayField.state.value;

					if (properties === null) {
						return (
							<Text c="dimmed" size="xs" ta="center">
								{props.notConfiguredLabel ??
									'Not configured. Click "Add property path" to add one.'}
							</Text>
						);
					}

					const propertyArray = properties ?? [];

					return (
						<Stack gap="sm">
							{propertyArray.length === 0 && (
								<Text c="dimmed" size="xs" ta="center">
									{props.emptyLabel ??
										'No properties configured. Click "Add property path" to create one.'}
								</Text>
							)}

							{propertyArray.map((property, index) => (
								<Paper key={property.id} p="sm" withBorder radius="md">
									<Group gap="sm" align="flex-end">
										<Box flex={1}>
											<props.form.AppField
												name={
													`${props.name}[${index}].value` as DisplayConfigPropertyFieldName
												}
											>
												{(valueField) => (
													<valueField.TextField
														required
														disabled={props.isLoading}
														label={`Path ${index + 1}`}
														placeholder="e.g., @name or smartphones.brand"
													/>
												)}
											</props.form.AppField>
										</Box>

										<Button
											size="sm"
											color="red"
											type="button"
											variant="subtle"
											disabled={props.isLoading}
											onClick={() => arrayField.removeValue(index)}
										>
											Remove
										</Button>
									</Group>
								</Paper>
							))}

							<Button
								type="button"
								variant="light"
								disabled={props.isLoading}
								onClick={() => arrayField.pushValue(props.buildNewRow())}
							>
								{props.buttonLabel ?? "Add property path"}
							</Button>
						</Stack>
					);
				}}
			</props.form.AppField>
		</Stack>
	);
}
