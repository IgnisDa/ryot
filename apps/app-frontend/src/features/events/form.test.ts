import { describe, expect, it } from "bun:test";

import { createEventSchemaFixture } from "~/features/test-fixtures";

import {
	buildCreateEventFormSchema,
	buildDefaultEventFormValues,
	buildEventSchemaSelectionPatch,
	getEventFormReconciliationState,
	getSelectedEventSchema,
	getUnsupportedRequiredEventProperties,
	reconcileEventProperties,
	syncCreateEventFormValues,
	toCreateEventPayload,
} from "./form";

describe("buildDefaultEventFormValues", () => {
	it("uses the current timestamp, first schema selection, and generated defaults", () => {
		const values = buildDefaultEventFormValues([
			createEventSchemaFixture({
				id: "schema-1",
				name: "Reading",
				slug: "reading",
				entitySchemaId: "entity-schema-1",
				propertiesSchema: {
					fields: {
						notes: { label: "Notes", description: "Notes", type: "string" },
						pages: {
							label: "Pages",
							description: "Pages",
							type: "integer",
							validation: { required: true },
						},
					},
				},
			}),
			createEventSchemaFixture({
				id: "schema-2",
				name: "Finished",
				slug: "finished",
				entitySchemaId: "entity-schema-1",
			}),
		]);

		expect(values.eventSchemaId).toBe("schema-1");
		expect(values.properties).toEqual({ pages: 0 });
	});

	it("uses the requested schema id when generating defaults", () => {
		const values = buildDefaultEventFormValues(
			[
				createEventSchemaFixture({
					id: "schema-1",
					name: "Reading",
					slug: "reading",
					entitySchemaId: "entity-schema-1",
					propertiesSchema: {
						fields: {
							pages: {
								label: "Pages",
								description: "Pages",
								type: "integer",
								validation: { required: true },
							},
						},
					},
				}),
				createEventSchemaFixture({
					id: "schema-2",
					name: "Finished",
					slug: "finished",
					entitySchemaId: "entity-schema-1",
					propertiesSchema: {
						fields: {
							completed: {
								type: "boolean",
								label: "Completed",
								description: "Completed",
								validation: { required: true },
							},
						},
					},
				}),
			],
			"schema-2",
		);

		expect(values.eventSchemaId).toBe("schema-2");
		expect(values.properties).toEqual({ completed: false });
	});

	it("falls back to the first schema when the requested schema id is invalid", () => {
		const values = buildDefaultEventFormValues(
			[
				createEventSchemaFixture({
					id: "schema-1",
					name: "Reading",
					slug: "reading",
					entitySchemaId: "entity-schema-1",
					propertiesSchema: {
						fields: {
							pages: {
								label: "Pages",
								description: "Pages",
								type: "integer",
								validation: { required: true },
							},
						},
					},
				}),
				createEventSchemaFixture({
					id: "schema-2",
					name: "Finished",
					slug: "finished",
					entitySchemaId: "entity-schema-1",
					propertiesSchema: {
						fields: {
							completed: {
								type: "boolean",
								label: "Completed",
								description: "Completed",
								validation: { required: true },
							},
						},
					},
				}),
			],
			"missing-schema",
		);

		expect(values.eventSchemaId).toBe("schema-1");
		expect(values.properties).toEqual({ pages: 0 });
	});

	it("skips non-primitive generated defaults", () => {
		const values = buildDefaultEventFormValues([
			createEventSchemaFixture({
				name: "Reading",
				slug: "reading",
				entitySchemaId: "entity-schema-1",
				propertiesSchema: {
					fields: {
						pages: {
							label: "Pages",
							description: "Pages",
							type: "integer",
							validation: { required: true },
						},
						tags: {
							label: "Tags",
							description: "Tags",
							type: "array",
							validation: { required: true },
							items: { label: "Tag", description: "Tag", type: "string" },
						},
						metadata: {
							type: "object",
							label: "Metadata",
							description: "Metadata",
							validation: { required: true },
							properties: {
								rating: {
									label: "Rating",
									description: "Rating",
									type: "number",
									validation: { required: true },
								},
							},
						},
					},
				},
			}),
		]);

		expect(values.properties).toEqual({ pages: 0 });
	});
});

describe("buildCreateEventFormSchema", () => {
	it("requires a schema selection", () => {
		const schema = buildCreateEventFormSchema();
		const result = schema.safeParse({
			properties: {},
			eventSchemaId: "  \n\t ",
		});

		expect(result.success).toBeFalse();
	});

	it("validates generated properties against the selected event schema", () => {
		const schema = buildCreateEventFormSchema([
			createEventSchemaFixture({
				id: "schema-1",
				propertiesSchema: {
					fields: {
						minutes: {
							label: "Minutes",
							description: "Minutes",
							type: "number",
						},
						completed: {
							type: "boolean",
							label: "Completed",
							description: "Completed",
							validation: { required: true },
						},
					},
				},
			}),
		]);
		const result = schema.safeParse({
			eventSchemaId: "schema-1",
			properties: { completed: true, minutes: "15" },
		});

		expect(result.success).toBeFalse();
	});

	it("switches validation based on the submitted schema id", () => {
		const schema = buildCreateEventFormSchema([
			createEventSchemaFixture({
				id: "schema-1",
				propertiesSchema: {
					fields: {
						pages: {
							label: "Pages",
							description: "Pages",
							type: "integer",
							validation: { required: true },
						},
					},
				},
			}),
			createEventSchemaFixture({
				id: "schema-2",
				name: "Finished",
				propertiesSchema: {
					fields: {
						completed: {
							type: "boolean",
							label: "Completed",
							description: "Completed",
							validation: { required: true },
						},
					},
				},
			}),
		]);

		const oldSchemaResult = schema.safeParse({
			eventSchemaId: "schema-1",
			properties: { completed: true },
		});
		const newSchemaResult = schema.safeParse({
			eventSchemaId: "schema-2",
			properties: { completed: true },
		});

		expect(oldSchemaResult.success).toBeFalse();
		expect(newSchemaResult.success).toBeTrue();
	});

	it("blocks schemas with required unsupported properties with a clear issue", () => {
		const schema = buildCreateEventFormSchema([
			createEventSchemaFixture({
				propertiesSchema: {
					fields: {
						pages: {
							label: "Pages",
							description: "Pages",
							type: "integer",
							validation: { required: true },
						},
						tags: {
							label: "Tags",
							description: "Tags",
							type: "array",
							items: { label: "Tag", description: "Tag", type: "string" },
							validation: { required: true },
						},
						metadata: {
							type: "object",
							label: "Metadata",
							description: "Metadata",
							validation: { required: true },
							properties: {
								rating: {
									label: "Rating",
									description: "Rating",
									type: "number",
									validation: { required: true },
								},
							},
						},
					},
				},
			}),
		]);
		const result = schema.safeParse({
			properties: { pages: 10 },
			eventSchemaId: "schema-1",
		});

		expect(result.success).toBeFalse();
		if (result.success) {
			throw new Error("Expected validation failure");
		}

		expect(result.error.issues).toContainEqual(
			expect.objectContaining({
				path: ["properties"],
				message:
					"This event schema cannot be logged here yet because it requires unsupported properties: tags, metadata.",
			}),
		);
	});
});

describe("getUnsupportedRequiredEventProperties", () => {
	it("returns only required unsupported property keys", () => {
		expect(
			getUnsupportedRequiredEventProperties({
				fields: {
					pages: {
						label: "Pages",
						description: "Pages",
						type: "integer",
						validation: { required: true },
					},
					notes: {
						label: "Notes",
						description: "Notes",
						type: "array",
						items: { label: "Note", description: "Note", type: "string" },
					},
					tags: {
						label: "Tags",
						description: "Tags",
						type: "array",
						items: { label: "Tag", description: "Tag", type: "string" },
						validation: { required: true },
					},
					metadata: {
						type: "object",
						label: "Metadata",
						description: "Metadata",
						validation: { required: true },
						properties: {
							rating: {
								type: "number",
								label: "Rating",
								description: "Rating",
								validation: { required: true },
							},
						},
					},
				},
			}),
		).toEqual(["tags", "metadata"]);
	});
});

describe("getSelectedEventSchema", () => {
	it("falls back to the first schema when the current selection is invalid", () => {
		const eventSchemas = [
			createEventSchemaFixture({
				id: "schema-1",
				name: "Reading",
				slug: "reading",
				entitySchemaId: "entity-schema-1",
			}),
			createEventSchemaFixture({
				id: "schema-2",
				name: "Finished",
				slug: "finished",
				entitySchemaId: "entity-schema-1",
			}),
		];

		expect(getSelectedEventSchema(eventSchemas, "missing-schema")?.id).toBe("schema-1");
	});
});

describe("toCreateEventPayload", () => {
	it("wraps the single event in an array and trims ids", () => {
		const payload = toCreateEventPayload(
			{
				eventSchemaId: "schema-1",
				properties: { completed: true },
			},
			"entity-1",
		);

		expect(payload).toEqual([
			{
				entityId: "entity-1",
				eventSchemaId: "schema-1",
				properties: { completed: true },
			},
		]);
	});

	it("drops stale properties after the schema selection changes", () => {
		const payload = toCreateEventPayload(
			{
				eventSchemaId: "schema-2",
				properties: { minutes: 15, completed: true },
			},
			"entity-1",
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: {
						fields: {
							minutes: {
								type: "number",
								label: "Minutes",
								description: "Minutes",
								validation: { required: true },
							},
						},
					},
				}),
				createEventSchemaFixture({
					id: "schema-2",
					name: "Finished",
					propertiesSchema: {
						fields: {
							completed: {
								type: "boolean",
								label: "Completed",
								description: "Completed",
								validation: { required: true },
							},
						},
					},
				}),
			],
		);

		expect(payload[0]?.properties).toEqual({ completed: true });
	});

	it("sanitizes unknown properties using the selected schema", () => {
		const sanitizedPayload = toCreateEventPayload(
			{
				eventSchemaId: "schema-1",
				properties: { minutes: 15, extra: "ignore-me" },
			},
			"entity-1",
			[
				createEventSchemaFixture({
					id: "schema-1",
					propertiesSchema: {
						fields: {
							minutes: {
								type: "number",
								label: "Minutes",
								description: "Minutes",
								validation: { required: true },
							},
						},
					},
				}),
			],
		);

		expect(sanitizedPayload[0]?.properties).toEqual({ minutes: 15 });
	});
});

describe("reconcileEventProperties", () => {
	it("preserves compatible values, resets missing required defaults, and drops stale keys", () => {
		expect(
			reconcileEventProperties(
				{
					fields: {
						notes: { label: "Notes", description: "Notes", type: "string" },
						pages: {
							label: "Pages",
							description: "Pages",
							type: "integer",
							validation: { required: true },
						},
						completed: {
							type: "boolean",
							label: "Completed",
							description: "Completed",
							validation: { required: true },
						},
					},
				},
				{ pages: 42, minutes: 15, completed: "yes", notes: "keep me" },
			),
		).toEqual({ pages: 42, notes: "keep me", completed: false });
	});

	it("skips unsupported properties while keeping supported values", () => {
		expect(
			reconcileEventProperties(
				{
					fields: {
						pages: {
							label: "Pages",
							description: "Pages",
							type: "integer",
							validation: { required: true },
						},
						tags: {
							label: "Tags",
							description: "Tags",
							type: "array",
							validation: { required: true },
							items: { label: "Tag", description: "Tag", type: "string" },
						},
					},
				},
				{ pages: 12, tags: ["a"] },
			),
		).toEqual({ pages: 12 });
	});
});

describe("syncCreateEventFormValues", () => {
	it("uses the current form schema selection to reconcile properties", () => {
		expect(
			syncCreateEventFormValues(
				[
					createEventSchemaFixture({
						id: "schema-1",
						propertiesSchema: {
							fields: {
								pages: {
									label: "Pages",
									description: "Pages",
									type: "integer",
									validation: { required: true },
								},
							},
						},
					}),
					createEventSchemaFixture({
						id: "schema-2",
						name: "Finished",
						propertiesSchema: {
							fields: {
								notes: { label: "Notes", description: "Notes", type: "string" },
								completed: {
									type: "boolean",
									label: "Completed",
									description: "Completed",
									validation: { required: true },
								},
							},
						},
					}),
				],
				{
					eventSchemaId: "schema-2",
					properties: { pages: 20, completed: true, notes: "keep me" },
				},
			),
		).toEqual({
			eventSchemaId: "schema-2",
			properties: { completed: true, notes: "keep me" },
		});
	});

	it("falls back to the first schema when the form selection becomes invalid", () => {
		expect(
			syncCreateEventFormValues(
				[
					createEventSchemaFixture({
						id: "schema-1",
						propertiesSchema: {
							fields: {
								pages: {
									label: "Pages",
									description: "Pages",
									type: "integer",
									validation: { required: true },
								},
							},
						},
					}),
					createEventSchemaFixture({
						id: "schema-2",
						name: "Finished",
						propertiesSchema: {
							fields: {
								completed: {
									type: "boolean",
									label: "Completed",
									description: "Completed",
									validation: { required: true },
								},
							},
						},
					}),
				],
				{ properties: { completed: true }, eventSchemaId: "missing-schema" },
			),
		).toEqual({ properties: { pages: 0 }, eventSchemaId: "schema-1" });
	});
});

describe("buildEventSchemaSelectionPatch", () => {
	it("reconciles properties for the newly selected schema", () => {
		expect(
			buildEventSchemaSelectionPatch(
				[
					createEventSchemaFixture({
						id: "schema-1",
						propertiesSchema: {
							fields: {
								pages: {
									label: "Pages",
									description: "Pages",
									type: "integer",
									validation: { required: true },
								},
							},
						},
					}),
					createEventSchemaFixture({
						id: "schema-2",
						name: "Finished",
						propertiesSchema: {
							fields: {
								notes: {
									label: "Notes",
									description: "Notes",
									type: "string",
								},
								completed: {
									type: "boolean",
									label: "Completed",
									description: "Completed",
									validation: { required: true },
								},
							},
						},
					}),
				],
				{
					eventSchemaId: "schema-1",
					properties: { pages: 20, completed: true, notes: "keep me" },
				},
				"schema-2",
			),
		).toEqual({
			eventSchemaId: "schema-2",
			properties: { completed: true, notes: "keep me" },
		});
	});
});

describe("getEventFormReconciliationState", () => {
	it("tracks the selected schema id and schema properties for reconciliation", () => {
		expect(
			getEventFormReconciliationState(
				[
					createEventSchemaFixture({
						id: "schema-1",
						propertiesSchema: {
							fields: {
								pages: {
									label: "Pages",
									description: "Pages",
									type: "integer",
									validation: { required: true },
								},
							},
						},
					}),
					createEventSchemaFixture({
						id: "schema-2",
						name: "Finished",
						propertiesSchema: {
							fields: {
								completed: {
									type: "boolean",
									label: "Completed",
									description: "Completed",
									validation: { required: true },
								},
							},
						},
					}),
				],
				"schema-2",
			),
		).toEqual({
			eventSchemaId: "schema-2",
			propertiesSchema: {
				fields: {
					completed: {
						type: "boolean",
						label: "Completed",
						description: "Completed",
						validation: { required: true },
					},
				},
			},
		});
	});

	it("falls back to the first available schema when the selected id is invalid", () => {
		expect(
			getEventFormReconciliationState(
				[
					createEventSchemaFixture({
						id: "schema-1",
						propertiesSchema: {
							fields: {
								pages: {
									label: "Pages",
									description: "Pages",
									type: "integer",
									validation: { required: true },
								},
							},
						},
					}),
				],
				"missing-schema",
			),
		).toEqual({
			eventSchemaId: "schema-1",
			propertiesSchema: {
				fields: {
					pages: {
						label: "Pages",
						description: "Pages",
						type: "integer",
						validation: { required: true },
					},
				},
			},
		});
	});
});
