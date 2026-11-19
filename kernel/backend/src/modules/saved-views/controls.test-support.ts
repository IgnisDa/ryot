import type { Filter } from "@ryot-app/contract/modules/filters/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import {
	compileControlFilter,
	compileControlSort,
	type ControlSchema,
	resolveControl,
} from "@ryot-app/ryotql-recipes/controls";
import { bindDocument } from "@ryot-app/ryotql/binding";
import { DateTime, Result } from "effect";

export const bindControlFixture = (input: {
	readonly sort?: string;
	readonly filter?: Filter;
	readonly now: DateTime.Utc;
	readonly document: RyotQLDocument;
	readonly schemas: readonly ControlSchema[];
	readonly arguments?: ExecutionRequest["arguments"];
}) =>
	bindDocument(input.document, input, {
		reportingTimeZone: "UTC",
		now: DateTime.toDateUtc(input.now),
		resolveSourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity:fixture" }),
		sort: (name, target, value) => {
			const query = input.document.queries[name];
			return query === undefined
				? Result.fail(new Error("Unknown query"))
				: Result.flatMap(resolveControl(target, query, input.schemas, input.document), (controls) =>
						compileControlSort(controls, value),
					);
		},
		filter: (name, target, value) => {
			const query = input.document.queries[name];
			return query === undefined
				? Result.fail(new Error("Unknown query"))
				: Result.flatMap(resolveControl(target, query, input.schemas, input.document), (controls) =>
						compileControlFilter(controls, query, value, DateTime.toDateUtc(input.now)),
					);
		},
	});
