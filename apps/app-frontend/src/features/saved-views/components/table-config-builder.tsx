import { Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import {
	buildDefaultPropertyPathRow,
	buildDefaultTableColumnRow,
	type SavedViewExtendedFormValues,
} from "../form-extended";
import {
	type DisplayConfigBuilderFormLike,
	PropertyArrayEditor,
} from "./display-config-fields";

type TableColumns =
	SavedViewExtendedFormValues["displayConfiguration"]["table"]["columns"];

type TableColumnsField = {
	state: { value: TableColumns };
	removeValue: (index: number) => void;
	pushValue: (value: TableColumns[number]) => void;
};

type TableConfigBuilderProps = {
	isLoading: boolean;
	form: DisplayConfigBuilderFormLike;
};

export function TableConfigBuilder(props: TableConfigBuilderProps) {
	return (
		<Stack gap="lg">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Table Display Configuration
				</Text>
				<Text c="dimmed" size="xs">
					Configure custom table columns. Each column label is shown in the
					header, and property paths use COALESCE resolution for the cell value.
				</Text>
			</Stack>

			<props.form.AppField
				name="displayConfiguration.table.columns"
				mode="array"
			>
				{(columnsFieldRaw) => {
					const columnsField = columnsFieldRaw as TableColumnsField;
					const columns = columnsField.state.value;

					return (
						<Stack gap="sm">
							{columns.length === 0 && (
								<Text c="dimmed" size="xs" ta="center">
									No columns configured. Click "Add column" to create one.
								</Text>
							)}

							{columns.map((column, index) => (
								<Paper key={column.id} p="sm" withBorder radius="md">
									<Stack gap="sm">
										<Group gap="sm" align="flex-end">
											<Box flex={1}>
												<props.form.AppField
													name={`displayConfiguration.table.columns[${index}].label`}
												>
													{(labelField) => (
														<labelField.TextField
															required
															placeholder="e.g., Brand"
															disabled={props.isLoading}
															label={`Column ${index + 1} Label`}
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
												onClick={() => columnsField.removeValue(index)}
											>
												Remove column
											</Button>
										</Group>

										<PropertyArrayEditor
											form={props.form}
											label="Column Properties"
											isLoading={props.isLoading}
											buttonLabel="Add column property"
											buildNewRow={buildDefaultPropertyPathRow}
											name={`displayConfiguration.table.columns[${index}].property`}
											description="Property paths for this column (COALESCE fallback order)"
											notConfiguredLabel='Not configured. Click "Add column property" to add one.'
											emptyLabel='No properties configured. Click "Add column property" to create one.'
										/>
									</Stack>
								</Paper>
							))}

							<Button
								type="button"
								variant="light"
								disabled={props.isLoading}
								onClick={() =>
									columnsField.pushValue(buildDefaultTableColumnRow())
								}
							>
								Add column
							</Button>
						</Stack>
					);
				}}
			</props.form.AppField>
		</Stack>
	);
}
