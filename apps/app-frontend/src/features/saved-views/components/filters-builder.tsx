import {
	Box,
	Button,
	Group,
	NumberInput,
	Paper,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import type { ReactNode } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import {
	buildDefaultFilterRow,
	type FilterRow,
	type SavedViewExtendedFormValues,
} from "../form-extended";
import type { ResolvedPropertyType } from "../resolve-property-type";
import { resolvePropertyType } from "../resolve-property-type";
import { PropertyPathAutocomplete } from "./property-path-autocomplete";

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
		// biome-ignore lint/suspicious/noExplicitAny: TanStack Form listener API has complex types
		listeners?: { onChange?: (opts: { value: any }) => void };
	}) => ReactNode | Promise<ReactNode>;
};

export const OPERATOR_OPTIONS = [
	{ label: "Equals (eq)", value: "eq" },
	{ label: "Not equals (ne)", value: "ne" },
	{ label: "Greater than (gt)", value: "gt" },
	{ label: "Greater or equal (gte)", value: "gte" },
	{ label: "Less than (lt)", value: "lt" },
	{ label: "Less or equal (lte)", value: "lte" },
	{ label: "In list (in)", value: "in" },
	{ label: "Is null (isNull)", value: "isNull" },
	{ label: "Contains (contains)", value: "contains" },
];

const COMPARISON_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "isNull"];
const STRING_OPS = ["eq", "ne", "in", "isNull", "contains"];
const BOOLEAN_OPS = ["eq", "ne", "isNull"];
const ARRAY_OPS = ["in", "isNull", "contains"];

const OPERATOR_COMPAT: Record<Exclude<ResolvedPropertyType, null>, string[]> = {
	array: ARRAY_OPS,
	string: STRING_OPS,
	date: COMPARISON_OPS,
	boolean: BOOLEAN_OPS,
	number: COMPARISON_OPS,
	integer: COMPARISON_OPS,
	object: OPERATOR_OPTIONS.filter((o) => o.value !== "contains").map(
		(o) => o.value,
	),
};

function getAllowedOps(type: ResolvedPropertyType): string[] {
	if (type === null) {
		return OPERATOR_OPTIONS.map((o) => o.value);
	}

	return OPERATOR_COMPAT[type];
}

// biome-ignore lint/suspicious/noExplicitAny: TanStack Form setFieldValue accepts any value
type SetFieldValue = (name: string, value: any) => void;

type FiltersBuilderProps = {
	isLoading: boolean;
	schemas: AppEntitySchema[];
	form: FiltersBuilderFormLike;
	setFieldValue: SetFieldValue;
};

type FilterRowItemProps = {
	index: number;
	filter: FilterRow;
	isLoading: boolean;
	onRemove: () => void;
	schemas: AppEntitySchema[];
	form: FiltersBuilderFormLike;
	setFieldValue: SetFieldValue;
};

function FilterRowItem(props: FilterRowItemProps) {
	const resolvedType = resolvePropertyType(props.filter.field, props.schemas);
	const allowedOps = getAllowedOps(resolvedType);
	const filteredOperatorOptions = OPERATOR_OPTIONS.filter((o) =>
		allowedOps.includes(o.value),
	);

	return (
		<Paper p="sm" withBorder radius="md">
			<Stack gap="sm">
				<Group gap="sm" align="flex-start">
					<Box flex={1}>
						<props.form.AppField
							name={`filters[${props.index}].field`}
							listeners={{
								onChange: ({ value }) => {
									props.setFieldValue(`filters[${props.index}].value`, "");
									const newAllowedOps = getAllowedOps(
										resolvePropertyType(value, props.schemas),
									);
									if (!newAllowedOps.includes(props.filter.op)) {
										props.setFieldValue(`filters[${props.index}].op`, "eq");
									}
								},
							}}
						>
							{(fieldField) => (
								<PropertyPathAutocomplete
									required
									label="Field"
									excludeImage
									schemas={props.schemas}
									disabled={props.isLoading}
									value={fieldField.state.value}
									onBlur={fieldField.handleBlur}
									error={!fieldField.state.meta.isValid}
									onChange={(value) => fieldField.handleChange(value)}
								/>
							)}
						</props.form.AppField>
					</Box>

					<Box flex={1}>
						<props.form.AppField
							name={`filters[${props.index}].op`}
							listeners={{
								onChange: () =>
									props.setFieldValue(`filters[${props.index}].value`, ""),
							}}
						>
							{(opField) => (
								<opField.SelectField
									required
									searchable
									label="Operator"
									disabled={props.isLoading}
									data={filteredOperatorOptions}
								/>
							)}
						</props.form.AppField>
					</Box>
				</Group>

				<props.form.AppField name={`filters[${props.index}].op`}>
					{(opStateField) =>
						opStateField.state.value !== "isNull" ? (
							<props.form.AppField name={`filters[${props.index}].value`}>
								{(valueField) => {
									const op = opStateField.state.value;

									if (resolvedType === "number" || resolvedType === "integer") {
										return (
											<NumberInput
												required
												label="Value"
												disabled={props.isLoading}
												onBlur={valueField.handleBlur}
												error={!valueField.state.meta.isValid}
												onChange={(val) =>
													valueField.handleChange(
														typeof val === "number" ? val : "",
													)
												}
												value={
													typeof valueField.state.value === "number"
														? valueField.state.value
														: ""
												}
											/>
										);
									}

									if (resolvedType === "boolean") {
										return (
											<Select
												required
												label="Value"
												disabled={props.isLoading}
												error={!valueField.state.meta.isValid}
												data={[
													{ label: "True", value: "true" },
													{ label: "False", value: "false" },
												]}
												value={
													valueField.state.value === true
														? "true"
														: valueField.state.value === false
															? "false"
															: null
												}
												onChange={(val) => {
													if (val === "true") {
														valueField.handleChange(true);
													} else if (val === "false") {
														valueField.handleChange(false);
													}
												}}
											/>
										);
									}

									if (resolvedType === "date") {
										const raw = valueField.state.value;
										const dateStr = typeof raw === "string" ? raw : "";
										return (
											<DateInput
												required
												label="Value"
												value={dateStr || null}
												valueFormat="YYYY-MM-DD"
												disabled={props.isLoading}
												error={!valueField.state.meta.isValid}
												onChange={(val) => valueField.handleChange(val ?? "")}
											/>
										);
									}

									return (
										<valueField.TextField
											required
											label="Value"
											disabled={props.isLoading}
											description={
												op === "in"
													? "Comma-separated values (e.g., Apple, Samsung)"
													: op === "contains" && resolvedType === "array"
														? "Single value to find in the list"
														: undefined
											}
											placeholder={
												op === "in"
													? "value1, value2, value3"
													: op === "contains"
														? "Enter text to search"
														: "Enter value"
											}
										/>
									);
								}}
							</props.form.AppField>
						) : null
					}
				</props.form.AppField>

				<Button
					fullWidth
					size="sm"
					color="red"
					type="button"
					variant="subtle"
					onClick={props.onRemove}
					disabled={props.isLoading}
				>
					Remove filter
				</Button>
			</Stack>
		</Paper>
	);
}

export function FiltersBuilder(props: FiltersBuilderProps) {
	return (
		<Stack gap="sm">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Filters
				</Text>
				<Text c="dimmed" size="xs">
					Add filters to narrow down results.
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
								<FilterRowItem
									index={index}
									key={filter.id}
									filter={filter}
									form={props.form}
									schemas={props.schemas}
									isLoading={props.isLoading}
									setFieldValue={props.setFieldValue}
									onRemove={() => arrayField.removeValue(index)}
								/>
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
