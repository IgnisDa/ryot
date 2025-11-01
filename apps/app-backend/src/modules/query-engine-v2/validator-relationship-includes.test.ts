import { describe, expect, it } from "vitest";

import type { IncludeEntryV2 } from "./language";
import { validateQueryDocumentV2 } from "./validator";
import { makeDoc, nameRef, propertyRef } from "./validator.test-support";

const moduleInclude = (overrides: Partial<IncludeEntryV2> = {}): IncludeEntryV2 => {
	const base: IncludeEntryV2 = {
		limit: 10,
		key: "modules",
		fields: [{ key: "name", expr: nameRef("module") }],
		orderBy: [{ order: "asc", expr: propertyRef("module", "modules", ["moduleNumber"]) }],
		source: {
			where: null,
			alias: "module",
			type: "entities",
			schemas: ["modules"],
			via: {
				entityRef: "e",
				direction: "outgoing",
				alias: "courseModule",
				schema: "course-module",
			},
		},
	};
	return { ...base, ...overrides };
};

const lessonInclude = (overrides: Partial<IncludeEntryV2> = {}): IncludeEntryV2 => {
	const base: IncludeEntryV2 = {
		limit: 10,
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
	};
	return { ...base, ...overrides };
};

describe("relationship includes", () => {
	it("accepts a one-hop entity include", () => {
		const doc = makeDoc({ output: { ...makeDoc().output, include: [moduleInclude()] } });
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("accepts nested entity includes", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude({ include: [lessonInclude()] })],
			},
		});
		expect(validateQueryDocumentV2(doc)).toBeNull();
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
		expect(validateQueryDocumentV2(doc)).toBeNull();
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
											...lessonInclude().source,
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
													...lessonInclude().source,
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Include depth exceeds maximum of 3/);
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
		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects include limit above 100", () => {
		const doc = makeDoc({
			output: { ...makeDoc().output, include: [moduleInclude({ limit: 101 })] },
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Include limit 101 exceeds maximum of 100/);
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
		expect(validateQueryDocumentV2(doc)).toMatch(/must specify via/);
	});

	it("rejects an include source where clause until include filtering is executable", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: { ...moduleInclude().source, where: nameRef("module") },
					}),
				],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/does not support where yet/);
	});

	it("rejects via entityRef outside scope", () => {
		const baseInclude = moduleInclude();
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [
					moduleInclude({
						source: {
							...baseInclude.source,
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'ghost'/);
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
		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'module'/);
	});

	it("rejects duplicate aliases across sibling includes", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				include: [moduleInclude(), moduleInclude({ key: "otherModules" })],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate alias 'courseModule'/);
	});

	it("rejects duplicate field and include keys", () => {
		const doc = makeDoc({
			output: {
				...makeDoc().output,
				fields: [{ key: "modules", expr: nameRef("e") }],
				include: [moduleInclude()],
			},
		});
		expect(validateQueryDocumentV2(doc)).toMatch(/Duplicate output field key 'modules'/);
	});

	it("rejects via on a root entity source", () => {
		const doc = makeDoc({ source: moduleInclude().source });
		expect(validateQueryDocumentV2(doc)).toMatch(/Root entity source cannot specify via/);
	});
});
