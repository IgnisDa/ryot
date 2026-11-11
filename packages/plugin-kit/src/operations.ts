import { PluginOperationJsonSchema } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Effect, Result, Schema, type SchemaRepresentation } from "effect";

export interface OperationRecipe<Input, InputEncoded, Output, OutputEncoded> {
	readonly operationSlug: string;
	readonly packageId: PluginPackageId;
	readonly input: Schema.Schema<Input> & Schema.Encoder<InputEncoded>;
	readonly output: Schema.Decoder<Output> & Schema.Encoder<OutputEncoded>;
}

export const defineOperationRecipe = <Input, InputEncoded, Output, OutputEncoded>(
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
): OperationRecipe<Input, InputEncoded, Output, OutputEncoded> => recipe;

export const invokeOperationRecipe = <Input, InputEncoded, Output, OutputEncoded, E, R>(
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
	transport: (request: {
		readonly payload: InputEncoded;
		readonly operationSlug: string;
		readonly packageId: PluginPackageId;
	}) => Effect.Effect<unknown, E, R>,
) =>
	Schema.encodeEffect(recipe.input)(input).pipe(
		Effect.flatMap((payload) =>
			transport({ payload, packageId: recipe.packageId, operationSlug: recipe.operationSlug }),
		),
		Effect.flatMap(Schema.decodeUnknownEffect(recipe.output)),
	);

export const operationJsonSchema = (schema: Schema.Constraint): PluginOperationJsonSchema => {
	const document = Schema.toRepresentation(schema);
	const visited = {
		required: new Set<SchemaRepresentation.Representation>(),
		optional: new Set<SchemaRepresentation.Representation>(),
	};
	const visit = (node: SchemaRepresentation.Representation, optional = false): void => {
		const seen = optional ? visited.optional : visited.required;
		if (seen.has(node)) {
			return;
		}
		seen.add(node);
		switch (node._tag) {
			case "Any":
			case "Enum":
			case "Null":
			case "Never":
			case "Number":
			case "String":
			case "Boolean":
			case "Unknown":
			case "ObjectKeyword":
				break;
			case "Void":
			case "BigInt":
			case "Symbol":
			case "UniqueSymbol":
				throw new Error(`Operation schema has no JSON representation: ${node._tag}`);
			case "Declaration":
				if (
					typeof node.annotations?.toCodecJson !== "function" &&
					typeof node.annotations?.toCodec !== "function"
				) {
					throw new Error("Operation schema has no JSON representation: Declaration");
				}
				break;

			case "Union":
				node.types.forEach((type) => visit(type, optional));
				break;

			case "Arrays":
				node.elements.forEach((element) => visit(element.type, element.isOptional));
				node.rest.forEach((type) => visit(type));
				break;
			case "Literal":
				if (
					typeof node.literal === "bigint" ||
					(typeof node.literal === "number" && !Number.isFinite(node.literal))
				) {
					throw new Error("Operation schema has a non-JSON literal");
				}
				break;
			case "Suspend":
				visit(node.thunk, optional);
				break;
			case "Objects":
				node.propertySignatures.forEach((property) => {
					if (typeof property.name === "symbol") {
						throw new Error("Operation schema has a symbol property");
					}
					visit(property.type, property.isOptional);
				});
				node.indexSignatures.forEach((index) => {
					visit(index.parameter);
					visit(index.type);
				});
				break;

			case "Undefined":
				if (!optional) {
					throw new Error("Operation schema has no JSON representation: Undefined");
				}
				break;
			case "Reference": {
				const target = document.references[node.$ref];
				if (target === undefined) {
					throw new Error(`Missing operation schema reference: ${node.$ref}`);
				}
				visit(target, optional);
				break;
			}
			case "TemplateLiteral":
				node.parts.forEach((part) => visit(part));
				break;
		}
	};
	visit(document.representation);
	const json = Schema.toJsonSchemaDocument(schema);
	return Result.getOrThrow(
		Schema.decodeUnknownResult(PluginOperationJsonSchema)({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			...json.schema,
			...(Object.keys(json.definitions).length === 0 ? {} : { $defs: json.definitions }),
		}),
	);
};
