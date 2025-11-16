import { Button, Code, Group, Paper, Stack, Text } from "@mantine/core";
import { EntitiesSection } from "#/features/entities/section";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { EventSchemasSection } from "#/features/event-schemas/section";
import { FacetIcon } from "#/features/facets/icons";

export interface TrackerOverviewProps {
	facetSlug: string;
	onAddEntitySchema: () => void;
	entitySchemas: AppEntitySchema[];
}

function EntitySchemaOverviewCard(props: {
	facetSlug: string;
	entitySchema: AppEntitySchema;
}) {
	const propertyCount = Object.keys(props.entitySchema.propertiesSchema).length;

	return (
		<Paper p="md" withBorder radius="md">
			<Stack gap="lg">
				<Group justify="space-between" align="flex-start">
					<Group gap="sm" align="flex-start">
						<Paper
							p="xs"
							radius="md"
							style={{
								color: props.entitySchema.accentColor,
								backgroundColor: `color-mix(in srgb, ${props.entitySchema.accentColor} 15%, transparent)`,
							}}
						>
							<FacetIcon
								size={20}
								strokeWidth={2}
								icon={props.entitySchema.icon}
							/>
						</Paper>
						<Stack gap={2}>
							<Text fw={600} size="lg">
								{props.entitySchema.name}
							</Text>
							<Group gap="xs">
								<Code>{props.entitySchema.slug}</Code>
								<Text c="dimmed" size="sm">
									•
								</Text>
								<Text c="dimmed" size="sm">
									{propertyCount}{" "}
									{propertyCount === 1 ? "property" : "properties"}
								</Text>
							</Group>
						</Stack>
					</Group>
				</Group>

				<Stack
					gap="md"
					p="md"
					style={{
						borderRadius: "var(--mantine-radius-md)",
						border: "1px solid var(--mantine-color-default-border)",
					}}
				>
					<EntitiesSection
						facetSlug={props.facetSlug}
						entitySchema={props.entitySchema}
					/>
				</Stack>

				<Stack
					gap="md"
					p="md"
					style={{
						borderRadius: "var(--mantine-radius-md)",
						border: "1px solid var(--mantine-color-default-border)",
					}}
				>
					<EventSchemasSection entitySchema={props.entitySchema} />
				</Stack>
			</Stack>
		</Paper>
	);
}

export function TrackerOverview(props: TrackerOverviewProps) {
	return (
		<Stack gap="md">
			{props.entitySchemas.map((entitySchema) => (
				<EntitySchemaOverviewCard
					key={entitySchema.id}
					entitySchema={entitySchema}
					facetSlug={props.facetSlug}
				/>
			))}

			<Paper p="md" withBorder radius="md" style={{ textAlign: "center" }}>
				<Stack gap="sm" align="center">
					<Text c="dimmed" size="sm">
						Need to track another type of entity?
					</Text>
					<Button size="sm" variant="light" onClick={props.onAddEntitySchema}>
						Add another entity schema
					</Button>
				</Stack>
			</Paper>
		</Stack>
	);
}
