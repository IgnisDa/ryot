import type { DataJsonDocument } from "@ryot-app/contract/modules/imports/data-json";
import {
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
} from "#modules/definition-registry/snapshot";

import { orderDataGraph } from "./data-graph";

const definitions = buildDefinitionSnapshot({
	savedViews: [],
	signalSchemas: [],
	relationshipSchemas: [
		{
			name: "Link",
			slug: "link",
			pluginId: null,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "record",
			targetEntitySchemaSlug: "record",
		},
	],
	entitySchemas: [
		{
			icon: "file",
			pluginId: null,
			name: "Record",
			slug: "record",
			pluginSlug: null,
			propertiesSchema: {
				fields: {
					parent: {
						type: "string",
						label: "Parent",
						description: "Parent record",
						reference: { kind: "entity-id" },
					},
				},
			},
			eventSchemas: [
				{
					pluginId: null,
					name: "Recorded",
					slug: "recorded",
					propertiesSchema: {
						fields: {
							link: {
								label: "Link",
								type: "string",
								description: "Related link",
								reference: { kind: "relationship-id" },
							},
						},
					},
				},
			],
		},
	],
});

const custom = (key: string, parent?: string): DataJsonDocument["entities"][number] => ({
	key,
	name: key,
	kind: "custom",
	properties: parent ? { parent } : {},
	entitySchema: { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("record") },
});

describe("Data graph dependency planning", () => {
	it("keeps kernel and same-name plugin schemas distinct when planning property references", () => {
		const source = definitionSourceFromSnapshot(definitions);
		const entity = source.entitySchemas[0];
		if (!entity) {
			throw new Error("Missing record fixture");
		}
		const snapshot = buildDefinitionSnapshot({
			...source,
			entitySchemas: [
				entity,
				{
					...entity,
					eventSchemas: [],
					pluginId: "first",
					pluginSlug: "whiskey",
					propertiesSchema: { fields: {} },
				},
				{
					...entity,
					pluginId: "second",
					pluginSlug: "whiskey",
					eventSchemas: Array.from(entity.eventSchemas, (event) => ({
						...event,
						pluginId: "second",
					})),
				},
			],
		});
		const plan = orderDataGraph(
			{
				events: [],
				relationships: [],
				entities: [
					{ ...custom("kernel", "missing") },
					{
						...custom("first", "missing"),
						entitySchema: {
							slug: EntitySchemaSlug.make("record"),
							owner: { kind: "plugin", pluginId: PluginId.make("first") },
						},
					},
					{
						...custom("second", "missing"),
						entitySchema: {
							slug: EntitySchemaSlug.make("record"),
							owner: { kind: "plugin", pluginId: PluginId.make("second") },
						},
					},
					{
						...custom("absent"),
						entitySchema: {
							slug: EntitySchemaSlug.make("record"),
							owner: { kind: "plugin", pluginId: PluginId.make("absent") },
						},
					},
				],
			},
			snapshot,
		);
		expect(plan.records.map(({ record }) => record.key)).toEqual(["first"]);
		expect(plan.failures.map(({ item, message }) => [item.record.key, message])).toEqual([
			["kernel", "Unknown reference 'missing'"],
			["second", "Unknown reference 'missing'"],
			["absent", "Schema is unavailable"],
		]);
	});
	it("orders forward property references before relationships and their dependent events", () => {
		const plan = orderDataGraph(
			{
				entities: [custom("child", "parent"), custom("parent")],
				events: [
					{
						key: "event",
						entityKey: "child",
						sessionEntityKey: "parent",
						eventSchemaSlug: "recorded",
						properties: { link: "link" },
						occurredAt: "2026-10-01T00:00:00Z",
					},
				],
				relationships: [
					{
						key: "link",
						properties: {},
						sourceEntityKey: "child",
						targetEntityKey: "parent",
						relationshipSchema: {
							owner: { kind: "kernel" },
							slug: RelationshipSchemaSlug.make("link"),
						},
					},
				],
			},
			definitions,
		);
		expect(plan.failures).toEqual([]);
		expect(plan.records.map(({ record }) => record.key)).toEqual([
			"parent",
			"child",
			"link",
			"event",
		]);
	});

	it("isolates a reference cycle while preserving independent records", () => {
		const plan = orderDataGraph(
			{
				events: [],
				relationships: [],
				entities: [custom("left", "right"), custom("right", "left"), custom("independent")],
			},
			definitions,
		);
		expect(plan.records.map(({ record }) => record.key)).toEqual(["independent"]);
		expect(plan.failures.map(({ item }) => item.record.key)).toEqual(["left", "right"]);
	});

	it("keeps dependents of invalid records in the execution plan so they get their own failure", () => {
		const plan = orderDataGraph(
			{
				events: [],
				relationships: [],
				entities: [
					custom("missing", "unknown"),
					custom("dependent", "missing"),
					custom("independent"),
				],
			},
			definitions,
		);
		expect(plan.failures.map(({ item }) => item.record.key)).toEqual(["missing"]);
		expect(plan.records.map(({ record }) => record.key)).toEqual(["dependent", "independent"]);
	});

	it("rejects duplicate identities across record kinds before planning any writes", () => {
		const plan = orderDataGraph(
			{
				relationships: [],
				entities: [custom("duplicate")],
				events: [
					{
						properties: {},
						key: "duplicate",
						entityKey: "duplicate",
						eventSchemaSlug: "recorded",
						occurredAt: "2026-10-01T00:00:00Z",
					},
				],
			},
			definitions,
		);
		expect(plan.records).toEqual([]);
		expect(plan.failures).toHaveLength(2);
	});
});
