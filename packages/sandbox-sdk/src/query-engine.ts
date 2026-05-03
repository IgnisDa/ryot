import { buildEntityReadQuery, buildEventReadQuery } from "@ryot/query-engine/recipes/sandbox";
import { Schema } from "@ryot/sandbox-sdk/effect";

import { entityRecordSchema, eventRecordSchema, type EntityRecord, type EventRecord } from "./core";

export { buildEntityReadQuery, buildEventReadQuery };

type QueryEngineRow = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is QueryEngineRow =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const queryEngineRows = (response: unknown): readonly QueryEngineRow[] => {
	if (Array.isArray(response)) {
		return response.filter(isRecord);
	}
	if (!isRecord(response)) {
		return [];
	}
	const result = response["data"];
	if (Array.isArray(result)) {
		return result.filter(isRecord);
	}
	const data = isRecord(result) && result["type"] === "rows" ? result["data"] : result;
	if (!isRecord(data) || !Array.isArray(data["items"])) {
		return [];
	}
	return data["items"].filter(isRecord);
};

const rowValues = (row: QueryEngineRow) =>
	Object.fromEntries(
		Object.entries(row).flatMap(([key, value]) =>
			isRecord(value) && "value" in value ? [[key, value["value"]]] : [],
		),
	);

export const queryEngineEntityRows = (response: unknown): readonly EntityRecord[] =>
	queryEngineRows(response).map((row) =>
		Schema.decodeUnknownSync(entityRecordSchema)(rowValues(row)),
	);

export const queryEngineEventRows = (response: unknown): readonly EventRecord[] =>
	queryEngineRows(response).map((row) => {
		const values = rowValues(row);
		const { sessionEntityId, ...rest } = values;
		return Schema.decodeUnknownSync(eventRecordSchema)({
			...rest,
			...(sessionEntityId === null ? {} : { sessionEntityId }),
		});
	});
