import { describe, expect, it } from "bun:test";

import { SchemaAST } from "effect";
import { HttpApi } from "effect/http-api";

import { AppContract } from "./contract";

const TEXT_FIELDS = new Set([
	"hint",
	"text",
	"error",
	"label",
	"title",
	"detail",
	"reason",
	"details",
	"message",
	"summary",
	"description",
]);

/** Compiler, query and definition diagnostics on plugin-author surfaces stay English. */
const diagnosticFields = [
	"PageAuthoringError.reason.diagnostics[].message",
	"PageAuthoringError.reason.message",
	"PluginConflictError.reason.diagnostics[].message",
	"PluginInvocationError.reason.diagnostics[].message",
	"PluginRequestError.reason.diagnostics[].message",
	"RyotQLBadRequest.reason.message",
];

const pendingValidationIssueFields = ["PublicationBadRequest.reason.issues[].message"];

const isText = (ast: SchemaAST.AST): boolean => {
	if (ast._tag === "String") {
		return true;
	}
	if (ast._tag === "Union") {
		return ast.types.some(isText);
	}
	return ast._tag === "Suspend" ? isText(ast.thunk()) : false;
};

const textFields = (
	ast: SchemaAST.AST,
	path: string,
	visited: Set<SchemaAST.AST>,
): ReadonlyArray<string> => {
	if (visited.has(ast)) {
		return [];
	}
	visited.add(ast);
	const nested = (member: SchemaAST.AST, memberPath = path) =>
		textFields(member, memberPath, visited);
	if (ast._tag === "Objects") {
		return [
			...ast.propertySignatures.flatMap((property) => {
				const fieldPath = `${path}.${String(property.name)}`;
				return [
					...(TEXT_FIELDS.has(String(property.name)) && isText(property.type) ? [fieldPath] : []),
					...nested(property.type, fieldPath),
				];
			}),
			...ast.indexSignatures.flatMap((index) => nested(index.type, `${path}[*]`)),
		];
	}
	if (ast._tag === "Arrays") {
		return [...ast.elements, ...ast.rest].flatMap((element) => nested(element, `${path}[]`));
	}
	if (ast._tag === "Union") {
		return ast.types.flatMap((member) => nested(member));
	}
	if (ast._tag === "Suspend") {
		return nested(ast.thunk());
	}
	return ast._tag === "Declaration" ? ast.typeParameters.flatMap((member) => nested(member)) : [];
};

const errorTag = (ast: SchemaAST.AST) => {
	const tag =
		ast._tag === "Objects"
			? ast.propertySignatures.find((property) => property.name === "_tag")?.type
			: undefined;
	return tag?._tag === "Literal" ? String(tag.literal) : "unknown";
};

const contractErrorTextFields = () => {
	const fields = new Set<string>();
	HttpApi.reflect(AppContract, {
		onGroup: () => undefined,
		onEndpoint: ({ errors }) => {
			for (const schemas of errors.values()) {
				for (const schema of schemas) {
					const encoded = SchemaAST.toEncoded(schema.ast);
					for (const field of textFields(encoded, errorTag(encoded), new Set())) {
						fields.add(field);
					}
				}
			}
		},
	});
	return [...fields].sort();
};

describe("AppContract errors", () => {
	it("carry user-facing text only as messages", () => {
		expect(contractErrorTextFields()).toEqual(
			[...diagnosticFields, ...pendingValidationIssueFields].sort(),
		);
	});
});
