import { PopulationStatus, TranslationStatus } from "@ryot-app/client-sdk";
import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import {
	and,
	ascending,
	castNumber,
	castText,
	column,
	defineRecipe,
	eq,
	inArray,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";
import { Badge } from "@ryot-app/client-ui-sdk";
import { isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

export const movePresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const move = table("entity", "presentationMove");
	const property = (key: string) => jsonPath(column(move, "properties"), key);
	return {
		queries: {
			moves: selectedRows(move, {
				limit: 100,
				orderBy: [ascending(column(move, "id"))],
				where: and(
					eq(column(move, "entitySchemaSlug"), literal("move")),
					inArray(
						column(move, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
				),
				selection: {
					id: selectedField(column(move, "id"), Schema.String),
					name: selectedField(column(move, "name"), Schema.String),
					populationStatus: selectedField(column(move, "populationStatus"), PopulationStatus),
					translationStatus: selectedField(column(move, "translationStatus"), TranslationStatus),
					type: selectedField(castText(property("type")), Schema.NullOr(Schema.String)),
					power: selectedField(castNumber(property("power")), Schema.NullOr(Schema.Number)),
					generation: selectedField(castText(property("generation")), Schema.NullOr(Schema.String)),
					damageClass: selectedField(
						castText(property("damageClass")),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
		map: ({ moves }) => Result.succeed(moves.items),
	};
});

export type MovePresentationData = Recipe.Success<typeof movePresentationRecipe>[number];

export const loadMovePresentations: EntityPresentationLoader<MovePresentationData> = async ({
	client,
	signal,
	references,
}) => {
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const moves = await client.data.query(movePresentationRecipe(entityIds), { signal });
	return Object.fromEntries(moves.map((move) => [move.id, move]));
};

function MovePresentation(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly data: MovePresentationData;
}) {
	return (
		<article
			data-layout={props.layout}
			data-entity-id={props.data.id}
			className={clsx(
				"min-w-0",
				props.layout === "grid"
					? "grid content-start gap-1.5"
					: "flex items-center justify-between gap-3 border-b border-border py-3",
				props.compact ? "text-[15px]" : "text-sm",
			)}
		>
			<div className="grid min-w-0 gap-1">
				<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
					{props.data.type ?? "Move"}
				</span>
				<span className="flex min-w-0 items-baseline gap-1.5">
					<PluginLink to={{ kind: "entity", entityId: props.data.id }} className="min-w-0">
						<span className="line-clamp-2 min-w-0 font-semibold text-text">{props.data.name}</span>
					</PluginLink>
					{isTitleProvisional(props.data) && <SyncPip reason="translating" />}
				</span>
				{props.data.damageClass !== null && (
					<span className="truncate text-xs text-text-muted">{props.data.damageClass}</span>
				)}
				{props.data.generation !== null && (
					<span className="truncate text-xs text-text-subtle">{props.data.generation}</span>
				)}
			</div>
			{props.data.power !== null && <Badge>{props.data.power}</Badge>}
		</article>
	);
}

function MoveCard({ data }: EntityPresentationComponentProps<MovePresentationData>) {
	const { compact } = useRyotViewport();
	return <MovePresentation compact={compact} layout="grid" data={data} />;
}

function MoveRow({ data }: EntityPresentationComponentProps<MovePresentationData>) {
	const { compact } = useRyotViewport();
	return <MovePresentation compact={compact} layout="list" data={data} />;
}

export const moveCardPresentation = defineEntityPresentation({
	component: MoveCard,
	loader: loadMovePresentations,
});

export const moveRowPresentation = defineEntityPresentation({
	component: MoveRow,
	loader: loadMovePresentations,
});
