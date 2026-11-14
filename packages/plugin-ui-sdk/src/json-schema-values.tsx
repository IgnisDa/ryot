import type { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import clsx from "clsx";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./icon";

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

const OPEN_DEPTH = 2;

const isComposite = (value: JsonValue) =>
	(isJsonArray(value) && value.some((item) => item !== null && typeof item === "object")) ||
	(isJsonObject(value) && Object.keys(value).length > 0);

const countLabel = (value: JsonValue) => {
	const [count, noun] = isJsonArray(value)
		? [value.length, "item"]
		: [Object.keys(isJsonObject(value) ? value : {}).length, "field"];
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
};

type ValueProps = {
	readonly depth: number;
	readonly value: JsonValue;
	readonly root: JsonSchema;
	readonly schema: JsonSchema;
};

export function JsonSchemaValues(props: {
	readonly value: JsonValue;
	readonly schema: JsonSchema;
}) {
	return (
		<div className="min-w-0 text-sm">
			<Value
				depth={0}
				root={props.schema}
				value={props.value}
				schema={resolve(props.schema, props.schema, props.value)}
			/>
		</div>
	);
}

function Group(props: ValueProps & { readonly label: string; readonly term: boolean }) {
	const [open, setOpen] = useState(props.depth <= OPEN_DEPTH);
	const Header = props.term ? "dt" : "div";
	const Body = props.term ? "dd" : "div";
	return (
		<div className="col-span-2 grid min-w-0 gap-1.5">
			<Header>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="inline-flex max-w-full items-center gap-1 rounded-sm text-left text-text-subtle hover:text-text"
				>
					<AppIcon
						size={14}
						name="chevron-right"
						className={clsx(
							"shrink-0 transition-transform duration-100 motion-reduce:transition-none",
							open && "rotate-90",
						)}
					/>
					<span className="min-w-0 break-words">{props.label}</span>{" "}
					<span className="shrink-0 text-xs">· {countLabel(props.value)}</span>
				</button>
			</Header>
			{open && (
				<Body className="ml-1.5 min-w-0 border-l border-border pl-3">
					<Value root={props.root} depth={props.depth} value={props.value} schema={props.schema} />
				</Body>
			)}
		</div>
	);
}

function Value(props: ValueProps): ReactNode {
	const { root, depth, value, schema } = props;
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
			<ol className="grid gap-1.5">
				{keyed.map(({ key, item }, index) => (
					<li key={key} className="min-w-0">
						{isComposite(item) ? (
							<Group
								root={root}
								term={false}
								value={item}
								depth={depth + 1}
								label={`Item ${index + 1}`}
								schema={resolve(items, root, item)}
							/>
						) : (
							<Value
								root={root}
								value={item}
								depth={depth + 1}
								schema={resolve(items, root, item)}
							/>
						)}
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
				const label = typeof title === "string" ? title : humanize(key);
				return isComposite(child) ? (
					<Group
						term
						key={key}
						root={root}
						label={label}
						value={child}
						depth={depth + 1}
						schema={childSchema}
					/>
				) : (
					<div key={key} className="contents">
						<dt className="text-text-subtle">{label}</dt>
						<dd className="min-w-0 font-medium">
							<Value root={root} value={child} depth={depth + 1} schema={childSchema} />
						</dd>
					</div>
				);
			})}
		</dl>
	);
}
