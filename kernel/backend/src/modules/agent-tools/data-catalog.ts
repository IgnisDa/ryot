import type { DiscoveryInput } from "@ryot-app/contract/schema/agent-tool";
import { capabilityOwner, KERNEL_CAPABILITY_OWNER } from "@ryot-app/contract/schema/capability";
import type { DefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import {
	canAccessCatalogTable,
	catalogTables,
	getCatalogTable,
	resolveCatalogField,
} from "@ryot-app/ryotql/catalog";
import { savedViewDataSourceAccess } from "@ryot-app/ryotql/validator";
import { sortBy } from "@ryot-app/ts-utils/lodash";

import { discover, type Discoverable, discoveryInstruction } from "./discovery";

type DataItem = Discoverable & {
	readonly full: Readonly<Record<string, unknown>>;
	readonly summary: Readonly<Record<string, unknown>>;
};

const tableItems = (): DataItem[] =>
	sortBy(Object.keys(catalogTables), (name) => name).flatMap((name) => {
		const table = getCatalogTable(name);
		if (table === undefined || !canAccessCatalogTable(table, savedViewDataSourceAccess)) {
			return [];
		}
		const fields = Object.keys(table.fields).flatMap((key) => {
			const field = resolveCatalogField(table, key, savedViewDataSourceAccess);
			return field === undefined ? [] : [[key, field] as const];
		});
		return [
			{
				description: `RyotQL table ${name}`,
				fields: fields.map(([key]) => key).join(" "),
				id: `${KERNEL_CAPABILITY_OWNER}:tables/${name}`,
				summary: { fields: fields.map(([key]) => key) },
				full: {
					primaryKey: [...table.primaryKey],
					fields: Object.fromEntries(
						fields.map(([key, field]) => [
							key,
							field.nullable ? `${field.kind} | null` : field.kind,
						]),
					),
				},
			},
		];
	});

export const dataItems = (
	snapshot: DefinitionSnapshot,
	packages: ReadonlyMap<string, string>,
): readonly DataItem[] => {
	const owner = (pluginId: null | string) =>
		pluginId === null ? KERNEL_CAPABILITY_OWNER : (packages.get(pluginId) ?? pluginId);
	return [
		...tableItems(),
		...Object.values(snapshot.entitySchemas).map((entity): DataItem => {
			const events = Object.values(entity.eventSchemas);
			const properties = Object.keys(entity.propertiesSchema.fields);
			return {
				id: `${owner(entity.pluginId)}:entities/${entity.slug}`,
				fields: [...properties, ...events.map((event) => event.slug)].join(" "),
				summary: { properties, name: entity.name, events: events.map((event) => event.slug) },
				description: `${entity.name} entities: table entity rows whose entitySchemaSlug is '${entity.slug}', with events in table event`,
				full: {
					name: entity.name,
					propertiesSchema: entity.propertiesSchema,
					...(entity.browse ? { browse: entity.browse } : {}),
					events: events.map((event) => ({
						slug: event.slug,
						name: event.name,
						propertiesSchema: event.propertiesSchema,
					})),
				},
			};
		}),
		...Object.values(snapshot.relationshipSchemas).map((relationship): DataItem => ({
			fields: Object.keys(relationship.propertiesSchema.fields).join(" "),
			id: `${owner(relationship.pluginId)}:relationships/${relationship.slug}`,
			description: `${relationship.name} relationships: table relationship rows whose relationshipSchemaSlug is '${relationship.slug}'`,
			summary: {
				name: relationship.name,
				source: relationship.sourceEntitySchemaSlug,
				target: relationship.targetEntitySchemaSlug,
			},
			full: {
				name: relationship.name,
				source: relationship.sourceEntitySchemaSlug,
				target: relationship.targetEntitySchemaSlug,
				propertiesSchema: relationship.propertiesSchema,
			},
		})),
	];
};

export const describeData = (items: readonly DataItem[], input: DiscoveryInput) => {
	const found = discover(items, (item) => item, input);
	if (found === null) {
		return {
			instruction: discoveryInstruction,
			namespaces: sortBy(
				Object.entries(Object.groupBy(items, (item) => capabilityOwner(item.id))).map(
					([namespace, members = []]) => ({ namespace, items: members.length }),
				),
				(entry) => (entry.namespace === KERNEL_CAPABILITY_OWNER ? "" : entry.namespace),
			),
		};
	}
	const detail = input.detail ?? "summary";
	return {
		total: found.total,
		items: found.selected.map((item) =>
			detail === "names"
				? item.id
				: Object.assign(
						{ id: item.id, description: item.description },
						detail === "full" ? item.full : item.summary,
					),
		),
	};
};
