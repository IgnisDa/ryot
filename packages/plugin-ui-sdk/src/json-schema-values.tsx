import type { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import type { ReactNode } from "react";

type JsonSchema = Readonly<Record<string, JsonValue>>;
type JsonObject = Readonly<Record<string, JsonValue>>;

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => isObjectRecord(value);
const isJsonArray = (value: JsonValue | undefined): value is readonly JsonValue[] =>
	Array.isArray(value);

const humanize = (key: string) => {
	const words = key
		.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll(/[_-]+/g, " ")
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.map((word) => (word === "id" ? "ID" : word));
	const [first = "", ...rest] = words;
	return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
};

const valueType = (value: JsonValue) => {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "number";
	}
	return typeof value;
};

const matchesType = (schema: JsonSchema, value: JsonValue) => {
	const type = valueType(value);
	const declared = schema["type"];
	if (declared === undefined) {
		return true;
	}
	const types = isJsonArray(declared) ? declared : [declared];
	return types.includes(type) || (type === "integer" && types.includes("number"));
};

const resolve = (schema: JsonValue | undefined, root: JsonSchema, value: JsonValue): JsonSchema => {
	if (!isJsonObject(schema)) {
		return {};
	}
	const reference = schema["$ref"];
	const definitions = root["$defs"];
	if (
		typeof reference === "string" &&
		reference.startsWith("#/$defs/") &&
		isJsonObject(definitions)
	) {
		return resolve(definitions[reference.slice("#/$defs/".length)], root, value);
	}
	const branches = schema["anyOf"] ?? schema["oneOf"];
	if (isJsonArray(branches)) {
		const resolved = branches.map((branch) => resolve(branch, root, value));
		return resolved.find((branch) => matchesType(branch, value)) ?? {};
	}
	return schema;
};

export function JsonSchemaValues(props: {
	readonly value: JsonValue;
	readonly schema: JsonSchema;
}) {
	return (
		<div className="min-w-0 text-sm">
			<Value
				root={props.schema}
				value={props.value}
				schema={resolve(props.schema, props.schema, props.value)}
			/>
		</div>
	);
}

function Value(props: {
	readonly value: JsonValue;
	readonly root: JsonSchema;
	readonly schema: JsonSchema;
}): ReactNode {
	const { root, value, schema } = props;
	if (value === null) {
		return <span className="text-text-subtle">None</span>;
	}
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (typeof value === "number" || typeof value === "string") {
		return <span className="break-words whitespace-pre-wrap">{String(value)}</span>;
	}
	if (!isJsonObject(value)) {
		if (value.length === 0) {
			return <span className="text-text-subtle">None</span>;
		}
		const items = resolve(schema["items"], root, value[0] ?? null);
		if (value.every((item) => item === null || typeof item !== "object")) {
			return value.map((item) => (item === null ? "None" : String(item))).join(", ");
		}
		const occurrences = new Map<string, number>();
		const keyed = value.map((item) => {
			const base = stableStringify(item);
			const occurrence = occurrences.get(base) ?? 0;
			occurrences.set(base, occurrence + 1);
			return { item, key: `${base}#${occurrence}` };
		});
		return (
			<ol className="grid gap-2">
				{keyed.map(({ key, item }) => (
					<li key={key} className="rounded-md border border-border p-2">
						<Value root={root} value={item} schema={resolve(items, root, item)} />
					</li>
				))}
			</ol>
		);
	}
	const properties = isJsonObject(schema["properties"]) ? schema["properties"] : {};
	const keys = [
		...Object.keys(properties).filter((key) => value[key] !== undefined),
		...Object.keys(value).filter((key) => properties[key] === undefined),
	];
	if (keys.length === 0) {
		return <span className="text-text-subtle">None</span>;
	}
	return (
		<dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
			{keys.map((key) => {
				const child = value[key] ?? null;
				const childSchema = resolve(properties[key], root, child);
				const title = childSchema["title"];
				return (
					<div key={key} className="contents">
						<dt className="text-text-subtle">
							{typeof title === "string" ? title : humanize(key)}
						</dt>
						<dd className="min-w-0 font-medium">
							<Value root={root} value={child} schema={childSchema} />
						</dd>
					</div>
				);
			})}
		</dl>
	);
}
