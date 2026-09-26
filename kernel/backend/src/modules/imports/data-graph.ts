import type { DataJsonDocument } from "@ryot-app/contract/modules/imports/data-json";
import {
	DataJsonEntity,
	DataJsonEvent,
	DataJsonRelationship,
} from "@ryot-app/contract/modules/imports/data-json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Schema } from "effect";

import { collectEmbeddedReferenceIds } from "#lib/domain/data-references";
import type { DefinitionSnapshot } from "#modules/definition-registry/snapshot";

export const DataGraphRecordSchema = Schema.Union([
	Schema.Struct({ record: DataJsonEntity, kind: Schema.Literal("entity") }),
	Schema.Struct({ record: DataJsonRelationship, kind: Schema.Literal("relationship") }),
	Schema.Struct({ record: DataJsonEvent, kind: Schema.Literal("event") }),
]);

export type DataGraphRecord = typeof DataGraphRecordSchema.Type;

const dataGraphRecords = (document: DataJsonDocument): ReadonlyArray<DataGraphRecord> => [
	...document.entities.map((record) => ({ record, kind: "entity" as const })),
	...document.relationships.map((record) => ({ record, kind: "relationship" as const })),
	...document.events.map((record) => ({ record, kind: "event" as const })),
];

export const dataGraphPropertiesSchema = (
	item: DataGraphRecord,
	entitySchemasByKey: ReadonlyMap<string, string>,
	definitions: DefinitionSnapshot,
): AppSchema | undefined => {
	if (item.kind === "entity") {
		return definitions.entitySchemas[item.record.entitySchemaSlug]?.propertiesSchema;
	}
	if (item.kind === "relationship") {
		return definitions.relationshipSchemas[item.record.relationshipSchemaSlug]?.propertiesSchema;
	}
	const entitySchemaSlug = entitySchemasByKey.get(item.record.entityKey);
	return entitySchemaSlug
		? definitions.entitySchemas[entitySchemaSlug]?.eventSchemas[item.record.eventSchemaSlug]
				?.propertiesSchema
		: undefined;
};

export const dataGraphDependencies = (item: DataGraphRecord, schema: AppSchema | undefined) => {
	let entityKeys: Array<string>;
	if (item.kind === "event") {
		entityKeys = [
			item.record.entityKey,
			...(item.record.sessionEntityKey ? [item.record.sessionEntityKey] : []),
		];
	} else if (item.kind === "relationship") {
		entityKeys = [item.record.sourceEntityKey, item.record.targetEntityKey];
	} else {
		entityKeys = [];
	}
	const propertyRecords =
		schema && "properties" in item.record
			? [{ propertiesSchema: schema, properties: item.record.properties }]
			: [];
	return {
		relationshipKeys: collectEmbeddedReferenceIds(propertyRecords, "relationship-id"),
		entityKeys: [
			...new Set([...entityKeys, ...collectEmbeddedReferenceIds(propertyRecords, "entity-id")]),
		],
	};
};

export const orderDataGraph = (document: DataJsonDocument, definitions: DefinitionSnapshot) => {
	const records = dataGraphRecords(document);
	const entitySchemasByKey = new Map(
		document.entities.map(({ key, entitySchemaSlug }) => [key, entitySchemaSlug]),
	);
	const entityKeys = new Set(document.entities.map(({ key }) => key));
	const relationshipKeys = new Set(document.relationships.map(({ key }) => key));
	const allKeys = new Set<string>();
	const failures: Array<{ item: DataGraphRecord; message: string }> = [];
	const validRecords = new Map<
		string,
		{ item: DataGraphRecord; dependencies: ReadonlyArray<string> }
	>();
	for (const item of records) {
		if (allKeys.has(item.record.key)) {
			return {
				records: [],
				entitySchemasByKey,
				failures: records.map((record) => ({
					item: record,
					message: `Duplicate record key '${item.record.key}'`,
				})),
			};
		}
		allKeys.add(item.record.key);
		const schema = dataGraphPropertiesSchema(item, entitySchemasByKey, definitions);
		const dependencies = dataGraphDependencies(item, schema);
		const unknown =
			dependencies.entityKeys.find((key) => !entityKeys.has(key)) ??
			dependencies.relationshipKeys.find((key) => !relationshipKeys.has(key));
		if (!schema || unknown) {
			failures.push({
				item,
				message: unknown ? `Unknown reference '${unknown}'` : "Schema is unavailable",
			});
		} else {
			validRecords.set(item.record.key, {
				item,
				dependencies: [...new Set([...dependencies.entityKeys, ...dependencies.relationshipKeys])],
			});
		}
	}
	const ordered: DataGraphRecord[] = [];
	const emittedFailures = new Set(failures.map(({ item }) => item.record.key));
	const remainingDependencies = new Map<string, number>();
	const dependents = new Map<string, Array<string>>();
	for (const [key, entry] of validRecords) {
		const pendingDependencies = entry.dependencies.filter(
			(dependency) => validRecords.has(dependency) && !emittedFailures.has(dependency),
		);
		remainingDependencies.set(key, pendingDependencies.length);
		for (const dependency of pendingDependencies) {
			const dependencyDependents = dependents.get(dependency) ?? [];
			dependencyDependents.push(key);
			dependents.set(dependency, dependencyDependents);
		}
	}
	const queue = [...validRecords.keys()].filter((key) => remainingDependencies.get(key) === 0);
	for (let index = 0; index < queue.length; index++) {
		const key = queue[index];
		if (key === undefined) {
			continue;
		}
		const entry = validRecords.get(key);
		if (!entry) {
			continue;
		}
		ordered.push(entry.item);
		for (const dependent of dependents.get(key) ?? []) {
			const remaining = (remainingDependencies.get(dependent) ?? 0) - 1;
			remainingDependencies.set(dependent, remaining);
			if (remaining === 0) {
				queue.push(dependent);
			}
		}
	}
	const orderedKeys = new Set(ordered.map(({ record }) => record.key));
	for (const [key, entry] of validRecords) {
		if (!orderedKeys.has(key)) {
			failures.push({
				item: entry.item,
				message: "Cyclic record references cannot be created incrementally",
			});
		}
	}
	return { failures, records: ordered, entitySchemasByKey };
};
