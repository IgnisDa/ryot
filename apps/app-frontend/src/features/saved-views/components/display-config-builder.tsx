import { Stack, Tabs, Text } from "@mantine/core";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import type { DisplayConfigBuilderFormLike } from "./display-config-fields";
import { GridConfigBuilder } from "./grid-config-builder";
import { ListConfigBuilder } from "./list-config-builder";
import { TableConfigBuilder } from "./table-config-builder";

type DisplayConfigBuilderProps = {
	isLoading: boolean;
	schemas: AppEntitySchema[];
	form: DisplayConfigBuilderFormLike;
};

export function DisplayConfigBuilder(props: DisplayConfigBuilderProps) {
	return (
		<Stack gap="sm">
			<Stack gap={2}>
				<Text fw={500} size="sm">
					Display Configuration
				</Text>
				<Text c="dimmed" size="xs">
					Edit grid, list, and table layouts independently. All layout changes
					are saved together.
				</Text>
			</Stack>

			<Tabs defaultValue="grid">
				<Tabs.List>
					<Tabs.Tab value="grid">Grid</Tabs.Tab>
					<Tabs.Tab value="list">List</Tabs.Tab>
					<Tabs.Tab value="table">Table</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel value="grid" pt="md">
					<GridConfigBuilder
						form={props.form}
						schemas={props.schemas}
						isLoading={props.isLoading}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="list" pt="md">
					<ListConfigBuilder
						form={props.form}
						schemas={props.schemas}
						isLoading={props.isLoading}
					/>
				</Tabs.Panel>

				<Tabs.Panel value="table" pt="md">
					<TableConfigBuilder
						form={props.form}
						schemas={props.schemas}
						isLoading={props.isLoading}
					/>
				</Tabs.Panel>
			</Tabs>
		</Stack>
	);
}
