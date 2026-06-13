import { describe, expect, it } from "vitest";

import type { EntitySource, IncludeEntry, NestedEventSource } from "./language";
import { makeDoc, nameRef, occurredAtRef, propertyRef } from "./validator.test-support";
import { validateQueryDocument } from "./validator/document";

const moduleSource: EntitySource = {
	where: null,
	alias: "module",
	type: "entities",
	schemas: ["modules"],
	via: { entityRef: "e", direction: "outgoing", alias: "courseModule", schema: "course-module" },
};

const lessonSource: EntitySource = {
	where: null,
	alias: "lesson",
	type: "entities",
	schemas: ["lessons"],
	via: {
		entityRef: "module",
		alias: "moduleLesson",
		direction: "outgoing",
		schema: "module-lesson",
	},
};

const moduleInclude = (overrides: Partial<IncludeEntry> = {}): IncludeEntry => {
	const base: IncludeEntry = {
		limit: 10,
		key: "modules",
		source: moduleSource,
		fields: [{ key: "name", expr: nameRef("module") }],
		orderBy: [{ order: "asc", expr: propertyRef("module", "modules", ["moduleNumber"]) }],
	};
	return { ...base, ...overrides };
};

const lessonInclude = (overrides: Partial<IncludeEntry> = {}): IncludeEntry => {
	const base: IncludeEntry = {
		limit: 10,
		key: "lessons",
		source: lessonSource,
		fields: [{ key: "name", expr: nameRef("lesson") }],
		orderBy: [{ order: "asc", expr: propertyRef("lesson", "lessons", ["lessonNumber"]) }],
	};
	return { ...base, ...overrides };
};

describe("relationship includes", () => {
	it("accepts a one-hop entity include", () => {
		const doc = makeDoc({ output: { ...makeDoc().output, include: [moduleInclude()] } });
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts nested entity includes", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude({ include: [lessonInclude()] })],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts exists over an event source attached to the included entity", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						include: [
							lessonInclude({
								fields: [
									{
										key: "isComplete",
										expr: {
											type: "exists",
											source: {
												where: null,
												type: "events",
												alias: "completion",
												entityRef: "lesson",
												schemas: ["complete"],
											},
										},
									},
								],
							}),
						],
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects include depth greater than 3", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						include: [
							lessonInclude({
								include: [
									lessonInclude({
										key: "parts",
										fields: [{ key: "name", expr: nameRef("part") }],
										orderBy: [{ order: "asc", expr: nameRef("part") }],
										source: {
											...lessonSource,
											alias: "part",
											schemas: ["parts"],
											via: {
												entityRef: "lesson",
												alias: "lessonPart",
												direction: "outgoing",
												schema: "lesson-part",
											},
										},
										include: [
											lessonInclude({
												key: "segments",
												fields: [{ key: "name", expr: nameRef("segment") }],
												orderBy: [{ order: "asc", expr: nameRef("segment") }],
												source: {
													...lessonSource,
													alias: "segment",
													schemas: ["segments"],
													via: {
														entityRef: "part",
														alias: "partSegment",
														direction: "outgoing",
														schema: "part-segment",
													},
												},
											}),
										],
									}),
								],
							}),
						],
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Include depth exceeds maximum of 3/);
	});

	it("accepts relationship edge fields in include output", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						fields: [
							{ key: "name", expr: nameRef("module") },
							{ key: "position", expr: propertyRef("courseModule", "course-module", ["position"]) },
						],
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects include limit above 100", () => {
		const doc = makeDoc({
			output: { ...makeDoc().output, include: [moduleInclude({ limit: 101 })] },
		});
		expect(validateQueryDocument(doc)).toMatch(/Include limit 101 exceeds maximum of 100/);
	});

	it("rejects an include source without via", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: { alias: "module", type: "entities", schemas: ["modules"], where: null },
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/must specify via/);
	});

	it("accepts a where on an included entity source referencing its own alias", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: {
							...moduleSource,
							where: {
								type: "comparison",
								operator: "gt",
								right: { type: "literal", value: 1 },
								left: propertyRef("module", "modules", ["moduleNumber"]),
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts a where on an included entity source referencing an ancestor alias", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: {
							...moduleSource,
							where: {
								type: "comparison",
								operator: "eq",
								left: nameRef("module"),
								right: nameRef("e"),
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects a where on an included source referencing an unknown alias", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude({ source: { ...moduleSource, where: nameRef("ghost") } })],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("rejects via entityRef outside scope", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: {
							...moduleSource,
							via: {
								alias: "courseModule",
								schema: "course-module",
								entityRef: "ghost",
								direction: "outgoing",
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("rejects sibling include aliases as traversal anchors", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude(),
					moduleInclude({
						key: "lessons",
						fields: [{ key: "name", expr: nameRef("lesson") }],
						orderBy: [{ order: "asc", expr: propertyRef("lesson", "lessons", ["lessonNumber"]) }],
						source: {
							where: null,
							alias: "lesson",
							type: "entities",
							schemas: ["lessons"],
							via: {
								entityRef: "module",
								alias: "moduleLesson",
								direction: "outgoing",
								schema: "module-lesson",
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'module'/);
	});

	it("rejects duplicate aliases across sibling includes", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude(), moduleInclude({ key: "otherModules" })],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Duplicate alias 'courseModule'/);
	});

	it("rejects duplicate field and include keys", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				fields: [{ key: "modules", expr: nameRef("e") }],
				include: [moduleInclude()],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Duplicate output field key 'modules'/);
	});

	it("rejects via on a root entity source", () => {
		const doc = makeDoc({ source: moduleSource });
		expect(validateQueryDocument(doc)).toMatch(/Root entity source cannot specify via/);
	});
});

const eventIncludeSource: NestedEventSource = {
	where: null,
	type: "events",
	entityRef: "e",
	alias: "completion",
	schemas: ["complete"],
};

const eventInclude = (overrides: Partial<IncludeEntry> = {}): IncludeEntry => {
	const base: IncludeEntry = {
		limit: 10,
		key: "completions",
		source: eventIncludeSource,
		fields: [{ key: "occurredAt", expr: occurredAtRef("completion") }],
		orderBy: [{ order: "desc", expr: occurredAtRef("completion") }],
	};
	return { ...base, ...overrides };
};

describe("event includes", () => {
	it("accepts an event include attached to an in-scope entity alias", () => {
		const doc = makeDoc({ output: { ...makeDoc().output, include: [eventInclude()] } });
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("accepts event property and attached-entity fields in an event include", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					eventInclude({
						fields: [
							{ key: "occurredAt", expr: occurredAtRef("completion") },
							{ key: "notes", expr: propertyRef("completion", "complete", ["notes"]) },
							{ key: "entityName", expr: nameRef("e") },
						],
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects an event include whose entityRef is out of scope", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [eventInclude({ source: { ...eventIncludeSource, entityRef: "ghost" } })],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("accepts a where on an event include", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					eventInclude({
						source: {
							...eventIncludeSource,
							where: {
								type: "comparison",
								operator: "gte",
								right: { type: "literal", value: 4 },
								left: propertyRef("completion", "complete", ["rating"]),
							},
						},
					}),
				],
			},
		});
		expect(validateQueryDocument(doc)).toBeNull();
	});

	it("rejects an orderBy ref to an alias outside the event include scope", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [eventInclude({ orderBy: [{ order: "desc", expr: occurredAtRef("ghost") }] })],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Unknown source alias 'ghost'/);
	});

	it("rejects nested includes under an event include", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [eventInclude({ include: [moduleInclude()] })],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/does not support nested includes/);
	});

	it("rejects an event include that collides with a sibling field key", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				fields: [{ key: "completions", expr: nameRef("e") }],
				include: [eventInclude()],
			},
		});
		expect(validateQueryDocument(doc)).toMatch(/Duplicate output field key 'completions'/);
	});
});
