import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	foldEachSubject,
	FoldInput,
	FoldOutput,
	type FoldResult,
} from "@ryot-app/plugin-backend-sdk/folds";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";

import { consumptionEventSlugs } from "../shared/consumption-projection";
import {
	librarySummaryKind,
	librarySummaryProperties,
	librarySummaryRefresh,
	librarySummarySourceRecipe,
} from "../shared/library-summary";
import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "../shared/lifecycle-expressions";
import { absorbFoldValues, MediaFoldValue } from "./fold/history";
import { foldMediaHistory } from "./fold/incremental";
import {
	type MediaFoldEventFilter,
	mediaFoldEventsRecipe,
	mediaFoldInventoryRecipe,
	mediaFoldLibraryLinksRecipe,
	mediaFoldSubjectRecipe,
	mediaFoldUncoveredRecipe,
} from "./fold/recipes";
import { MediaSandboxError } from "./lib/failures";

export const manifest = defineManifest({
	kind: "script",
	slug: "fold.media-history",
	name: "Fold media history",
});

const terminalStatuses = new Set(["ended", "canceled", "cancelled"]);

export default defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: foldEachSubject((input, host) =>
		Effect.gen(function* () {
			const subjectEntityId = input.subjectEntityId;
			const subject = yield* executeRyotqlRecipe(host.executeRyotql, mediaFoldSubjectRecipe, {
				subjectEntityId,
			});
			if (!subject) {
				return yield* new MediaSandboxError({ message: "Fold subject is unavailable" });
			}
			const events = (filter?: MediaFoldEventFilter) =>
				readAllRyotqlPages((after) =>
					executeRyotqlRecipe(
						host.executeRyotql,
						mediaFoldEventsRecipe(filter),
						{ subjectEntityId },
						{ pages: { events: { after: after } } },
					),
				);
			const consumption = { slugs: consumptionEventSlugs };
			const config = [showEpisodicKindConfig, podcastEpisodicKindConfig].find(
				({ parentSchemaSlug }) => parentSchemaSlug === subject.entitySchemaSlug,
			);
			const productionStatus = subject.properties["productionStatus"];
			const { renamedKeys, value: previous } = absorbFoldValues(
				input.value === null
					? { occurrences: [] }
					: yield* Schema.decodeUnknownEffect(MediaFoldValue)(input.value),
				yield* Effect.forEach(input.absorbed, ({ ids, value }) =>
					Schema.decodeUnknownEffect(MediaFoldValue)(value).pipe(
						Effect.map((decoded) => ({ ids, value: decoded })),
					),
				),
			);
			const derived = yield* foldMediaHistory({
				previous,
				renamedKeys,
				changes: input.changes,
				subject: {
					id: subjectEntityId,
					episodic: config !== undefined,
					terminal:
						typeof productionStatus === "string" &&
						terminalStatuses.has(productionStatus.trim().toLowerCase()),
				},
				reads: {
					history: events(),
					runs: ({ runs, entityId }) => events({ ...consumption, runs, entityId }),
					completions: ({ until, entityId }) =>
						events({ until, entityId, unsourced: true, slugs: ["complete"] }),
					entity: ({ from, entityId }) =>
						events({ ...consumption, entityId, ...(from === null ? {} : { from }) }),
					since: ({ from, limit, excluded }) =>
						executeRyotqlRecipe(
							host.executeRyotql,
							mediaFoldEventsRecipe({ ...consumption, from, limit, excluded }),
							{ subjectEntityId },
						).pipe(Effect.map(({ items }) => items)),
					uncovered: ({ excluded }) =>
						config === undefined
							? Effect.succeed(true)
							: executeRyotqlRecipe(
									host.executeRyotql,
									mediaFoldUncoveredRecipe({ config, excluded }),
									{ subjectEntityId },
								),
					inventory:
						config === undefined
							? Effect.succeed([])
							: readAllRyotqlPages((after) =>
									executeRyotqlRecipe(
										host.executeRyotql,
										mediaFoldInventoryRecipe({ config: config }),
										{ subjectEntityId },
										{ pages: { episodes: { after: after } } },
									),
								).pipe(Effect.map((episodes) => episodes.map(({ id }) => id))),
				},
			});
			const links = yield* executeRyotqlRecipe(host.executeRyotql, mediaFoldLibraryLinksRecipe, {
				subjectEntityId,
			});
			const [summary] =
				links.length === 0
					? []
					: yield* executeRyotqlRecipe(
							host.executeRyotql,
							librarySummarySourceRecipe({ kind: librarySummaryKind(subject.entitySchemaSlug) }),
							{ entityIds: [subjectEntityId] },
						);
			const properties = summary
				? librarySummaryProperties(summary)
				: { lifecycleState: "untracked" };
			const refresh = summary ? librarySummaryRefresh(summary) : undefined;
			return {
				...(refresh === undefined ? {} : { refresh }),
				changes: derived.changes,
				events: derived.contributions,
				relationships: links.map((relationshipId) => ({ properties, relationshipId })),
				value: yield* Schema.encodeEffect(Schema.toCodecJson(MediaFoldValue))(derived.value),
			} satisfies FoldResult;
		}),
	),
});
