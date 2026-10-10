import { Result } from "@ryot-app/client-sdk/effect";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
	type EntityPresentationPrepare,
	type EntityReference,
} from "@ryot-app/client-sdk/plugin";
import { defineRecipe } from "@ryot-app/client-sdk/ryotql";
import { Badge } from "@ryot-app/client-ui-sdk";
import { isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import {
	movePresentationSource,
	type MovePresentationSourceData,
} from "../shared/entity-presentations";

export type MovePresentationData = {
	readonly damageClass: MovePresentationSourceData["presentationDamageClass"];
	readonly generation: MovePresentationSourceData["presentationGeneration"];
	readonly name: string;
	readonly power: MovePresentationSourceData["presentationPower"];
	readonly type: MovePresentationSourceData["presentationType"];
};

const buildMovePresentations = (
	references: readonly EntityReference[],
	sources: readonly MovePresentationSourceData[],
) => {
	const byId = new Map(sources.map((source) => [source.presentationId, source]));
	return Result.map(
		Result.all(
			references.map((reference) => {
				const source = byId.get(reference.entityId);
				return source === undefined
					? Result.fail(new Error(`Missing move presentation source for '${reference.entityId}'`))
					: Result.succeed(source);
			}),
		),
		(rows) =>
			Object.fromEntries(
				rows.map((source) => [
					source.presentationId,
					{
						name: source.presentationName,
						type: source.presentationType,
						power: source.presentationPower,
						generation: source.presentationGeneration,
						damageClass: source.presentationDamageClass,
					},
				]),
			),
	);
};

export const prepareMovePresentations: EntityPresentationPrepare<MovePresentationData> = ({
	sources,
	references,
}) => {
	const source = movePresentationSource();
	return Result.flatMap(
		Result.all(references.map((reference) => source.decode(sources.get(reference.entityId)))),
		(rows) => buildMovePresentations(references, rows),
	);
};

export const loadMovePresentations: EntityPresentationLoader<MovePresentationData> = ({
	client,
	references,
}) => {
	const source = movePresentationSource();
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const recipe = defineRecipe(() => ({
		queries: { presentations: source.query(entityIds) },
		map: ({ presentations }) => buildMovePresentations(references, presentations.items),
	}))();
	return client.data.query(recipe);
};

function MovePresentation(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly data: MovePresentationData;
	readonly reference: EntityReference;
}) {
	return (
		<article
			data-layout={props.layout}
			data-entity-id={props.reference.entityId}
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
					<PluginLink
						className="min-w-0"
						to={{ kind: "entity", entityId: props.reference.entityId }}
					>
						<span className="line-clamp-2 min-w-0 font-semibold text-text">{props.data.name}</span>
					</PluginLink>
					{isTitleProvisional(props.reference) && <SyncPip reason="translating" />}
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

function MoveCard({ data, reference }: EntityPresentationComponentProps<MovePresentationData>) {
	const { compact } = useRyotViewport();
	return <MovePresentation data={data} layout="grid" compact={compact} reference={reference} />;
}

function MoveRow({ data, reference }: EntityPresentationComponentProps<MovePresentationData>) {
	const { compact } = useRyotViewport();
	return <MovePresentation data={data} layout="list" compact={compact} reference={reference} />;
}

export const moveCardPresentation = defineEntityPresentation({
	component: MoveCard,
	loader: loadMovePresentations,
	prepare: prepareMovePresentations,
});

export const moveRowPresentation = defineEntityPresentation({
	component: MoveRow,
	loader: loadMovePresentations,
	prepare: prepareMovePresentations,
});
