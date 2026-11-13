import type { PluginOperationJsonSchema } from "@ryot-app/contract/modules/plugins/manifest";
import type { Capability } from "@ryot-app/contract/schema/capability";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { JsonSchema, SchemaAST, SchemaRepresentation } from "effect";

type PrintedType = {
	readonly type: string;
	readonly references: readonly (readonly [name: string, type: string])[];
};

const json = (text: string) => text.replaceAll("Schema.Json", "Json");

const printJsonSchemaType = (schema: PluginOperationJsonSchema): PrintedType => {
	try {
		const imported = SchemaRepresentation.fromJsonSchemaDocument(
			JsonSchema.fromSchemaDraft2020_12(schema),
		);
		const document = SchemaRepresentation.toCodeDocument(
			SchemaRepresentation.toMultiDocument(
				SchemaRepresentation.toRepresentation(SchemaAST.toType(imported.ast)),
			),
		);
		const [root] = document.codes;
		if (!root) {
			return { type: "Json", references: [] };
		}
		return {
			type: json(root.Type),
			references: [
				...document.references.nonRecursives.map(
					({ $ref, code }) => [$ref, json(code.Type)] as const,
				),
				...Object.entries(document.references.recursives).map(
					([name, code]) => [name, json(code.Type)] as const,
				),
			],
		};
	} catch {
		return { type: "Json", references: [] };
	}
};

const printSide = (label: string, printed: PrintedType) =>
	[
		`${label}: ${printed.type}`,
		...printed.references.map(([name, type]) => `  where ${name} = ${type}`),
	].join("\n");

const range = (minimum: unknown, maximum: unknown, unit: string) => {
	if (typeof minimum === "number" && typeof maximum === "number") {
		return `${minimum} to ${maximum}${unit}`;
	}
	if (typeof minimum === "number") {
		return `at least ${minimum}${unit}`;
	}
	return typeof maximum === "number" ? `at most ${maximum}${unit}` : null;
};

const fieldNotes = (schema: unknown, path: string): readonly string[] => {
	if (!isObjectRecord(schema)) {
		return [];
	}
	const notes = [
		typeof schema["description"] === "string" ? schema["description"] : null,
		range(schema["minimum"], schema["maximum"], ""),
		schema["minLength"] === 1 && schema["maxLength"] === undefined
			? "non-empty"
			: range(schema["minLength"], schema["maxLength"], " characters"),
		range(schema["minItems"], schema["maxItems"], " items"),
	].filter((note) => note !== null);
	const properties = isObjectRecord(schema["properties"]) ? schema["properties"] : {};
	return [
		...(path === "" || notes.length === 0 ? [] : [`  ${path}: ${notes.join("; ")}`]),
		...Object.entries(properties).flatMap(([key, child]) =>
			fieldNotes(child, path === "" ? key : `${path}.${key}`),
		),
		...fieldNotes(schema["items"], `${path}[]`),
	];
};

const printNotes = (label: string, schema: PluginOperationJsonSchema) => {
	const notes = fieldNotes(schema, "");
	return notes.length === 0 ? [] : [`${label} notes:`, ...notes];
};

export const capabilitySignature = (capability: Capability) =>
	[
		printSide("input", printJsonSchemaType(capability.input)),
		...printNotes("input", capability.input),
		printSide("output", printJsonSchemaType(capability.output)),
	].join("\n");

const namespace = (name: string, printed: PrintedType) =>
	`declare namespace ${name} {\n${printed.references
		.map(([reference, type]) => `  type ${reference} = ${type};\n`)
		.join("")}  export type T = ${printed.type};\n}`;

export const capabilityDeclarations = (capabilities: readonly Capability[]) => {
	const blocks = capabilities.map((capability, index) => ({
		id: capability.id,
		input: namespace(`Input${index}`, printJsonSchemaType(capability.input)),
		output: namespace(`Output${index}`, printJsonSchemaType(capability.output)),
	}));
	return [
		"type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json };",
		...blocks.flatMap((block) => [block.input, block.output]),
		`interface Capabilities {\n${blocks
			.map(
				(block, index) =>
					`  ${JSON.stringify(block.id)}: { input: Input${index}.T; output: Output${index}.T };\n`,
			)
			.join("")}}`,
	].join("\n");
};
