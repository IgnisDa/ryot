import { Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

type PropertyArrayFieldMeta = {
	isValid: boolean;
	isDirty?: boolean;
	isBlurred?: boolean;
	errors: Array<{ message?: string } | undefined>;
};

type PropertyArrayField = {
	pushValue: (value: string) => void;
	removeValue: (index: number) => void;
	state: {
		meta: PropertyArrayFieldMeta;
		value: string[] | null | undefined;
	};
};

type GridConfigFieldName =
	| "displayConfiguration.grid.imageProperty"
	| "displayConfiguration.grid.titleProperty"
	| "displayConfiguration.grid.subtitleProperty"
	| "displayConfiguration.grid.badgeProperty"
	| `displayConfiguration.grid.imageProperty[${number}]`
	| `displayConfiguration.grid.titleProperty[${number}]`
	| `displayConfiguration.grid.subtitleProperty[${number}]`
	| `displayConfiguration.grid.badgeProperty[${number}]`;

type GridConfigBuilderFormLike = {
	AppField: <TName extends GridConfigFieldName>(props: {
		name: TName;
		// biome-ignore lint/suspicious/noExplicitAny: TanStack Form field API has complex types
		children: (field: any) => ReactNode;
		mode?: TName extends
			| "displayConfiguration.grid.imageProperty"
			| "displayConfiguration.grid.titleProperty"
			| "displayConfiguration.grid.subtitleProperty"
			| "displayConfiguration.grid.badgeProperty"
			? "array"
			: never;
	}) => ReactNode | Promise<ReactNode>;
};

type GridConfigBuilderProps = {
	isLoading: boolean;
	form: GridConfigBuilderFormLike;
};

function PropertyArrayEditor(props: {
	label: string;
	isLoading: boolean;
	description: string;
	form: GridConfigBuilderFormLike;
	name:
		| "displayConfiguration.grid.imageProperty"
		| "displayConfiguration.grid.titleProperty"
		| "displayConfiguration.grid.subtitleProperty"
		| "displayConfiguration.grid.badgeProperty";
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
								Not configured. Click "Add property path" to add one.
							</Text>
						);
					}

					const propertyArray = properties ?? [];

					return (
						<Stack gap="sm">
							{propertyArray.length === 0 && (
								<Text c="dimmed" size="xs" ta="center">
									No properties configured. Click "Add property path" to create
									one.
								</Text>
							)}

							{propertyArray.map((_, index) => (
								<Paper
									key={`${props.name}-${
										// biome-ignore lint/suspicious/noArrayIndexKey: stable index within controlled list
										index
									}`}
									p="sm"
									withBorder
									radius="md"
								>
									<Group gap="sm" align="flex-end">
										<Box flex={1}>
											<props.form.AppField
												name={`${props.name}[${index}]` as GridConfigFieldName}
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
								onClick={() => arrayField.pushValue("")}
							>
								Add property path
							</Button>
						</Stack>
					);
				}}
			</props.form.AppField>
		</Stack>
	);
}

export function GridConfigBuilder(props: GridConfigBuilderProps) {
	return (
		<Stack gap="lg">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Grid Display Configuration
				</Text>
				<Text c="dimmed" size="xs">
					Configure how entities display in grid view. Property paths use
					COALESCE resolution (first non-null value wins). Use{" "}
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

			<PropertyArrayEditor
				form={props.form}
				label="Image Property"
				isLoading={props.isLoading}
				name="displayConfiguration.grid.imageProperty"
				description="Property paths for card image (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Title Property"
				isLoading={props.isLoading}
				name="displayConfiguration.grid.titleProperty"
				description="Property paths for card title (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Subtitle Property"
				isLoading={props.isLoading}
				name="displayConfiguration.grid.subtitleProperty"
				description="Property paths for card subtitle (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Badge Property"
				isLoading={props.isLoading}
				name="displayConfiguration.grid.badgeProperty"
				description="Property paths for card badge (COALESCE fallback order)"
			/>
		</Stack>
	);
}
