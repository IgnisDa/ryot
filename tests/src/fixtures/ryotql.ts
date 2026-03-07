import type { ContractPayload, ContractSuccess } from "@ryot/contract/client";
import type { FieldValue, RowItem } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { requireString } from "~/support/assertions";

import type { Client } from "./auth";

export type RyotQLPayload = ContractPayload<"ryotql", "execute">;
export type RyotQLResponse = ContractSuccess<"ryotql", "execute">;

export const executeRyotQL = (client: Client, document: RyotQLPayload) =>
	client.call((contract) => contract.ryotql.execute({ payload: document }));

export const requireRyotQLFieldValue = (item: RowItem, key: string): FieldValue => {
	const field = item[key];
	if (!field || !("kind" in field)) {
		throw new Error(`Expected field '${key}'`);
	}
	return field;
};

export const requireRyotQLTextField = (item: RowItem, key: string) => {
	const field = requireRyotQLFieldValue(item, key);
	if (field.kind !== "text") {
		throw new Error(`Expected text field '${key}'`);
	}
	return requireString(field.value, `Expected '${key}' to contain text`);
};

export const executeRyotQLError = (client: Client, document: RyotQLPayload) =>
	Effect.flip(executeRyotQL(client, document));
