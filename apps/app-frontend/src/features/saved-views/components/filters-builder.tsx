import { Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import {
	buildDefaultFilterRow,
	type FilterRow,
	type SavedViewExtendedFormValues,
} from "../form-extended";

type FilterFieldMeta = {
	isValid: boolean;
	isDirty?: boolean;
	isBlurred?: boolean;
	errors: Array<{ message?: string } | undefined>;
};

type FiltersArrayField = {
	removeValue: (index: number) => void;
	pushValue: (value: FilterRow) => void;
	state: {
		meta: FilterFieldMeta;
		value: SavedViewExtendedFormValues["filters"];
	};
};

type FilterFieldName =
	| "filters"
	| `filters[${number}].field`
	| `filters[${number}].op`
	| `filters[${number}].value`;

type FiltersBuilderFormLike = {
	AppField: <TName extends FilterFieldName>(props: {
		name: TName;
		// biome-ignore lint/suspicious/noExplicitAny: TanStack Form field API has complex types
		children: (field: any) => ReactNode;
		mode?: TName extends "filters" ? "array" : never;
	}) => ReactNode | Promise<ReactNode>;
};

const OPERATOR_OPTIONS = [
	{ label: "Equals (eq)", value: "eq" },
	{ label: "Not equals (ne)", value: "ne" },
	{ label: "Greater than (gt)", value: "gt" },
	{ label: "Greater or equal (gte)", value: "gte" },
	{ label: "Less than (lt)", value: "lt" },
	{ label: "Less or equal (lte)", value: "lte" },
	{ label: "In list (in)", value: "in" },
	{ label: "Is null (isNull)", value: "isNull" },
];

type FiltersBuilderProps = {
	isLoading: boolean;
	form: FiltersBuilderFormLike;
};

export function FiltersBuilder(props: FiltersBuilderProps) {
	return (
		<Stack gap="sm">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Filters
				</Text>
				<Text c="dimmed" size="xs">
					Add filters to narrow down results. Use{" "}
					<Text span c="gray.7" ff="var(--font-family-monospace)">
						@name
					</Text>{" "}
					for built-in properties or{" "}
					<Text span c="gray.7" ff="var(--font-family-monospace)">
						schema.property
					</Text>{" "}
					for schema-specific fields.
				</Text>
				<Text c="dimmed" size="xs">
					Operators: eq equals, ne not equals, gt/gte greater than, lt/lte less
					than, in matches a comma-separated list, isNull checks for missing
					values.
				</Text>
			</Stack>

			<props.form.AppField name="filters" mode="array">
				{(filtersArrayField) => {
					const arrayField = filtersArrayField as FiltersArrayField;
					const filters = arrayField.state.value;

					return (
						<Stack gap="sm">
							{filters.length === 0 && (
								<Text c="dimmed" size="xs" ta="center">
									No filters configured. Click "Add filter" to create one.
								</Text>
							)}

							{filters.map((filter, index) => (
								<Paper key={filter.id} p="sm" withBorder radius="md">
									<Stack gap="sm">
										<Group gap="sm" align="flex-start">
											<Box flex={1}>
												<props.form.AppField name={`filters[${index}].field`}>
													{(fieldField) => (
														<fieldField.TextField
															required
															label="Field"
															disabled={props.isLoading}
															placeholder="e.g., @name or brand"
														/>
													)}
												</props.form.AppField>
											</Box>

											<Box flex={1}>
												<props.form.AppField name={`filters[${index}].op`}>
													{(opField) => (
														<opField.SelectField
															required
															searchable
															label="Operator"
															disabled={props.isLoading}
															data={OPERATOR_OPTIONS}
														/>
													)}
												</props.form.AppField>
											</Box>
										</Group>

										{filter.op !== "isNull" && (
											<props.form.AppField name={`filters[${index}].value`}>
												{(valueField) => (
													<valueField.TextField
														label="Value"
														disabled={props.isLoading}
														required={filter.op !== "isNull"}
														description={
															filter.op === "in"
																? "Comma-separated values (e.g., Apple, Samsung)"
																: undefined
														}
														placeholder={
															filter.op === "in"
																? "value1, value2, value3"
																: "Enter value"
														}
													/>
												)}
											</props.form.AppField>
										)}

										<Button
											fullWidth
											size="sm"
											color="red"
											type="button"
											variant="subtle"
											disabled={props.isLoading}
											onClick={() => arrayField.removeValue(index)}
										>
											Remove filter
										</Button>
									</Stack>
								</Paper>
							))}

							<Button
								type="button"
								variant="light"
								disabled={props.isLoading}
								onClick={() => arrayField.pushValue(buildDefaultFilterRow())}
							>
								Add filter
							</Button>
						</Stack>
					);
				}}
			</props.form.AppField>
		</Stack>
	);
}
