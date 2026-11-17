import { Result } from "@ryot-app/plugin-client-sdk/effect";
import {
	defineEntityPresentation,
	type EntityPresentationComponentProps,
	type EntityPresentationPrepare,
	type EntityReference,
	PluginLink,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useMessages } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Eyebrow } from "@ryot-app/plugin-ui-sdk";
import { isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";

import {
	movePresentationSource,
	type MovePresentationSourceData,
} from "../shared/entity-presentations";
import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export type MovePresentationData = {
	readonly name: string;
	readonly type: MovePresentationSourceData["presentationType"];
	readonly power: MovePresentationSourceData["presentationPower"];
	readonly generation: MovePresentationSourceData["presentationGeneration"];
	readonly damageClass: MovePresentationSourceData["presentationDamageClass"];
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

function MoveRow({ data, reference }: EntityPresentationComponentProps<MovePresentationData>) {
	const { compact } = useRyotViewport();
	return <MovePresentation data={data} layout="list" compact={compact} reference={reference} />;
}

function MoveCard({ data, reference }: EntityPresentationComponentProps<MovePresentationData>) {
	const { compact } = useRyotViewport();
	return <MovePresentation data={data} layout="grid" compact={compact} reference={reference} />;
}

function MovePresentation(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly data: MovePresentationData;
	readonly reference: EntityReference;
}) {
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
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
				<Eyebrow>{props.data.type ?? text("entity-schema.move.name")}</Eyebrow>
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

export const moveCardPresentation = defineEntityPresentation({
	component: MoveCard,
	prepare: prepareMovePresentations,
});

export const moveRowPresentation = defineEntityPresentation({
	component: MoveRow,
	prepare: prepareMovePresentations,
});
