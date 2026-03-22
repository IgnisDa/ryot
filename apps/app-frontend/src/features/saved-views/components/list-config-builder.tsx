import { Stack, Text } from "@mantine/core";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { buildDefaultPropertyPathRow } from "../form-extended";
import {
	type DisplayConfigBuilderFormLike,
	PropertyArrayEditor,
} from "./display-config-fields";

type ListConfigBuilderProps = {
	isLoading: boolean;
	schemas: AppEntitySchema[];
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
					COALESCE resolution (first non-null value wins).
				</Text>
			</Stack>

			<PropertyArrayEditor
				form={props.form}
				label="Image Property"
				schemas={props.schemas}
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.imageProperty"
				description="Property paths for list image (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Title Property"
				schemas={props.schemas}
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.titleProperty"
				description="Property paths for list title (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				schemas={props.schemas}
				label="Subtitle Property"
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.subtitleProperty"
				description="Property paths for list subtitle (COALESCE fallback order)"
			/>

			<PropertyArrayEditor
				form={props.form}
				label="Badge Property"
				schemas={props.schemas}
				isLoading={props.isLoading}
				buildNewRow={buildDefaultPropertyPathRow}
				name="displayConfiguration.list.badgeProperty"
				description="Property paths for list badge (COALESCE fallback order)"
			/>
		</Stack>
	);
}
