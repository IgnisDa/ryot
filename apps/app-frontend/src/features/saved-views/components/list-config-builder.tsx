import { Stack, Text } from "@mantine/core";
import { buildDefaultPropertyPathRow } from "../form-extended";
import {
	type DisplayConfigBuilderFormLike,
	PropertyArrayEditor,
} from "./display-config-fields";

type ListConfigBuilderProps = {
	isLoading: boolean;
	form: DisplayConfigBuilderFormLike;
};

export function ListConfigBuilder(props: ListConfigBuilderProps) {
	return (
		<Stack gap="lg">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					List Display Configuration
				</Text>
				<Text c="dimmed" size="xs">
					Configure how entities display in list view. Property paths use
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
				name="displayConfiguration.list.imageProperty"
				description="Property paths for list image (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Title Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.titleProperty"
				description="Property paths for list title (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Subtitle Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.subtitleProperty"
				description="Property paths for list subtitle (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Badge Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.badgeProperty"
				description="Property paths for list badge (COALESCE fallback order)"
			/>
		</Stack>
	);
}
