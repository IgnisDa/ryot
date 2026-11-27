import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { ScalarExpression, TableReference } from "@ryot-app/contract/modules/ryotql/authored";
import type { SavedViewDisplayKind } from "@ryot-app/contract/modules/saved-views/schemas";
import { SavedViewDisplayValue } from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	castText,
	column,
	concat,
	conditional,
	contains,
	literal,
	or,
	selectedField,
	selectedRows,
	startsWith,
} from "@ryot-app/ryotql";
import type { RowsQuery } from "@ryot-app/ryotql/filters";
import { Result, Schema } from "effect";

export const librarySearchQuery = (input: {
	readonly source: RowsQuery;
	readonly entity: TableReference;
	readonly search: ScalarExpression;
	readonly image?: ScalarExpression;
	readonly searchExpressions: readonly [ScalarExpression, ...ScalarExpression[]];
	readonly subtitle?: {
		readonly expression: ScalarExpression;
		readonly displayKind: SavedViewDisplayKind;
	};
}) => {
	const matching = (predicate: typeof contains, text: ScalarExpression) =>
		or(...input.searchExpressions.map((expression) => predicate(castText(expression), text)));
	const rank = conditional(
		matching(startsWith, input.search),
		literal(0),
		conditional(matching(contains, concat(literal(" "), input.search)), literal(1), literal(2)),
	);
	if ("type" in input.source.output.orderBy) {
		throw new Error("Library search requires fixed source ordering");
	}
	return selectedRows(input.source.from, {
		limit: 5,
		maxLimit: 100,
		joins: input.source.joins,
		where: and(
			...(input.source.where ? [input.source.where] : []),
			matching(contains, input.search),
		),
		orderBy: [
			ascending(rank),
			...input.source.output.orderBy,
			ascending(column(input.entity, "id")),
		],
		selection: {
			rank: selectedField(rank, Schema.Finite),
			name: selectedField(column(input.entity, "name"), Schema.String),
			entityId: selectedField(column(input.entity, "id"), Schema.String),
			image: selectedField(input.image ?? literal(null), Schema.NullOr(AssetLocator)),
			subtitle: selectedField(input.subtitle?.expression ?? literal(null), JsonValue),
		},
	});
};

const hit = Schema.Struct({
	name: Schema.String,
	rank: Schema.Finite,
	subtitle: JsonValue,
	entityId: Schema.String,
	image: Schema.NullOr(AssetLocator),
});
const envelope = Schema.Struct({ data: Schema.Record(Schema.String, Schema.Unknown) });
const hitsResult = Schema.Struct({ items: Schema.Array(hit), type: Schema.Literal("rows") });
const countResult = Schema.Struct({
	type: Schema.Literal("aggregate"),
	items: Schema.Array(Schema.Struct({ count: Schema.Finite })),
});

export const decodeLibrarySearch = (
	hits: unknown,
	count: unknown,
	subtitleKind: null | SavedViewDisplayKind,
) =>
	Result.gen(function* () {
		const hitEnvelope = yield* Schema.decodeUnknownResult(envelope)(hits);
		const countEnvelope = yield* Schema.decodeUnknownResult(envelope)(count);
		const page = yield* Schema.decodeUnknownResult(hitsResult)(hitEnvelope.data["librarySearch"]);
		const totals = yield* Schema.decodeUnknownResult(countResult)(
			countEnvelope.data["librarySearchCount"],
		);
		const total = totals.items[0];
		if (totals.items.length !== 1 || total === undefined) {
			return yield* Result.fail(new Error("Library search count must contain one row"));
		}
		if (new Set(page.items.map((item) => item.entityId)).size !== page.items.length) {
			return yield* Result.fail(new Error("Library search contains duplicate entities"));
		}
		const decoded = yield* Result.all(
			page.items.map((item) =>
				Result.map(
					Schema.decodeUnknownResult(Schema.NullOr(SavedViewDisplayValue))(
						subtitleKind === null ? null : { value: item.subtitle, displayKind: subtitleKind },
					),
					(subtitle) => ({ ...item, subtitle }),
				),
			),
		);
		return { hits: decoded, total: total.count };
	});
