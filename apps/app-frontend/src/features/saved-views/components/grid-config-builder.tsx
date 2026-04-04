import { Stack, Text } from "@mantine/core";
import { buildDefaultPropertyPathRow } from "../form-extended";
import {
	type DisplayConfigBuilderFormLike,
	PropertyArrayEditor,
} from "./display-config-fields";

type GridConfigBuilderProps = {
	isLoading: boolean;
	form: DisplayConfigBuilderFormLike;
};

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
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.grid.imageProperty"
				description="Property paths for card image (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Title Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.grid.titleProperty"
				description="Property paths for card title (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Subtitle Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.grid.subtitleProperty"
				description="Property paths for card subtitle (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Badge Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.grid.badgeProperty"
				description="Property paths for card badge (COALESCE fallback order)"
			/>
		</Stack>
	);
}
