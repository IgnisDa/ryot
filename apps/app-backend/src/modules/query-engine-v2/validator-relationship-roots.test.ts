import { describe, expect, it } from "vitest";

import { validateQueryDocumentV2 } from "./validator";
import {
	createdAtRef,
	nameRef,
	propertyRef,
	type RowsQueryDocumentV2,
} from "./validator.test-support";

const makeRelationshipDoc = (
	overrides: Partial<RowsQueryDocumentV2> = {},
): RowsQueryDocumentV2 => ({
	version: 2,
	output: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "desc", expr: createdAtRef("membership") }],
	},
	source: {
		where: null,
		type: "relationships",
		alias: "membership",
		schemas: ["member-of"],
		sourceEntity: { alias: "memberEntity", schemas: ["books"] },
		targetEntity: { alias: "collectionEntity", schemas: ["collections"] },
	},
	...overrides,
});

describe("relationship root sources", () => {
	it("accepts a relationship root source with both endpoint declarations", () => {
		expect(validateQueryDocumentV2(makeRelationshipDoc())).toBeNull();
	});

	it("accepts fields referencing the relationship alias and both endpoint entity aliases", () => {
		const doc = makeRelationshipDoc({
			output: {
				type: "rows",
				pagination: { page: 1, limit: 10 },
				orderBy: [{ order: "desc", expr: createdAtRef("membership") }],
				fields: [
					{ key: "memberName", expr: nameRef("memberEntity") },
					{ key: "collectionName", expr: nameRef("collectionEntity") },
					{
						key: "position",
						expr: propertyRef("membership", "member-of", ["position"]),
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it.each(["id", "sourceEntityId", "targetEntityId", "createdAt"])(
		"accepts valid relationship system field '%s'",
		(name) => {
			const doc = makeRelationshipDoc({
				output: {
					...makeRelationshipDoc().output,
					fields: [
						{
							key: "f",
							expr: { type: "ref", sourceAlias: "membership", field: { type: "system", name } },
						},
					],
				},
			});
			expect(validateQueryDocumentV2(doc)).toBeNull();
		},
	);

	it("rejects an invalid system field for the relationship alias", () => {
		const doc = makeRelationshipDoc({
			output: {
				...makeRelationshipDoc().output,
				fields: [{ key: "f", expr: nameRef("membership") }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(
			/Invalid system field 'name' for relationship edge/,
		);
	});

	it("rejects a relationship property field whose schema is not in the relationship schemas", () => {
		const doc = makeRelationshipDoc({
			output: {
				...makeRelationshipDoc().output,
				fields: [{ key: "f", expr: propertyRef("membership", "other-schema", ["position"]) }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(
			/schema 'other-schema'.*not in relationship edge schemas/,
		);
	});

	it("rejects an endpoint entity property field whose schema is not in the endpoint schemas", () => {
		const doc = makeRelationshipDoc({
			output: {
				...makeRelationshipDoc().output,
				fields: [{ key: "f", expr: propertyRef("memberEntity", "movies", ["title"]) }],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/schema 'movies'.*not in source schemas/);
	});

	it("rejects duplicate relationship schema slugs", () => {
		const doc = makeRelationshipDoc({
			source: { ...makeRelationshipDoc().source, schemas: ["member-of", "member-of"] },
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate schema 'member-of'/);
	});

	it("rejects a duplicate alias between the relationship and an endpoint entity", () => {
		const doc = makeRelationshipDoc({
			source: {
				where: null,
				alias: "membership",
				type: "relationships",
				schemas: ["member-of"],
				sourceEntity: { alias: "membership", schemas: ["books"] },
				targetEntity: { alias: "collectionEntity", schemas: ["collections"] },
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate alias 'membership'/);
	});

	it("rejects a duplicate alias between the two endpoint entities", () => {
		const doc = makeRelationshipDoc({
			source: {
				where: null,
				alias: "membership",
				type: "relationships",
				schemas: ["member-of"],
				sourceEntity: { alias: "shared", schemas: ["books"] },
				targetEntity: { alias: "shared", schemas: ["collections"] },
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate alias 'shared'/);
	});

	it("rejects a non-null where clause on a root relationship source", () => {
		const doc = makeRelationshipDoc({
			source: { ...makeRelationshipDoc().source, where: nameRef("memberEntity") },
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/does not support where yet/);
	});

	it("rejects include on relationship root rows", () => {
		const doc = makeRelationshipDoc({
			output: {
				...makeRelationshipDoc().output,
				include: [
					{
						limit: 10,
						key: "ghost",
						fields: [],
						orderBy: [{ order: "asc", expr: nameRef("ghost") }],
						source: {
							where: null,
							alias: "ghost",
							type: "entities",
							schemas: ["ghosts"],
							via: {
								alias: "ghostEdge",
								schema: "ghost-edge",
								direction: "outgoing",
								entityRef: "memberEntity",
							},
						},
					},
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(
			/Relationship root rows do not support include yet/,
		);
	});
});
