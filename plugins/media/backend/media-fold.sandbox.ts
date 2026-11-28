import { readAllPages, type ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	type FoldEventChange,
	FoldInput,
	FoldOutput,
	foldSubjects,
	type FoldValueResult,
} from "@ryot-app/plugin-backend-sdk/folds";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { consumptionEventSlugs } from "../shared/consumption-projection";
import {
	librarySummaryKind,
	librarySummaryProperties,
	librarySummaryRefresh,
	librarySummarySourceRecipe,
} from "../shared/library-summary";
import { absorbFoldValues, MediaFoldValue } from "./fold/history";
import { foldMediaHistory } from "./fold/incremental";
import {
	mediaFoldEpisodicRecipes,
	mediaFoldEventsRecipe,
	mediaFoldLibraryLinksRecipe,
	mediaFoldSubjectRecipe,
} from "./fold/recipes";
import { MediaSandboxError } from "./lib/failures";

export const manifest = defineManifest({
	kind: "script",
	slug: "fold.media-history",
	name: "Fold media history",
});

const terminalStatuses = new Set(["ended", "canceled", "cancelled"]);

const foldSubject = (
	input: {
		readonly subjectEntityId: string;
		readonly value: null | MediaFoldValue;
		readonly changes: null | ReadonlyArray<FoldEventChange>;
		readonly absorbed: ReadonlyArray<{
			readonly value: MediaFoldValue;
			readonly ids: Readonly<Record<string, string>>;
		}>;
	},
	host: ScriptHost,
) =>
	Effect.gen(function* () {
		const subjectEntityId = input.subjectEntityId;
		const subject = yield* executeRyotqlRecipe(host.executeRyotql, mediaFoldSubjectRecipe, {
			subjectEntityId,
		});
		if (!subject) {
			return yield* new MediaSandboxError({ message: "Fold subject is unavailable" });
		}
		const events = (filter: {
			readonly from?: string;
			readonly until?: string;
			readonly entityId?: string;
			readonly runs?: ReadonlyArray<string>;
			readonly slugs?: ReadonlyArray<string>;
		}) =>
			readAllPages((after) =>
				executeRyotqlRecipe(
					host.executeRyotql,
					mediaFoldEventsRecipe,
					{ ...filter, subjectEntityId },
					{ pages: { events: { after } } },
				),
			);
		const episodic = mediaFoldEpisodicRecipes.find(
			({ config }) => config.parentSchemaSlug === subject.entitySchemaSlug,
		);
		const productionStatus = subject.properties["productionStatus"];
		const { renamedKeys, value: previous } = absorbFoldValues(
			input.value ?? { occurrences: [] },
			input.absorbed,
		);
		const derived = yield* foldMediaHistory({
			previous,
			renamedKeys,
			changes: input.changes,
			subject: {
				id: subjectEntityId,
				episodic: episodic !== undefined,
				terminal:
					typeof productionStatus === "string" &&
					terminalStatuses.has(productionStatus.trim().toLowerCase()),
			},
			reads: {
				history: events({}),
				runs: ({ runs, entityId }) => events({ runs, entityId, slugs: consumptionEventSlugs }),
				completions: ({ until, entityId }) => events({ until, entityId, slugs: ["complete"] }),
				entity: ({ from, entityId }) =>
					events({ entityId, slugs: consumptionEventSlugs, ...(from === null ? {} : { from }) }),
				uncovered: ({ excluded }) =>
					episodic === undefined
						? Effect.succeed(true)
						: executeRyotqlRecipe(host.executeRyotql, episodic.uncovered, {
								subjectEntityId,
								...(excluded.length === 0 ? {} : { excluded }),
							}),
				since: ({ from, limit, excluded }) =>
					executeRyotqlRecipe(
						host.executeRyotql,
						mediaFoldEventsRecipe,
						{ from, excluded, subjectEntityId, slugs: consumptionEventSlugs },
						{ pages: { events: { limit } } },
					).pipe(Effect.map(({ items }) => items)),
				inventory:
					episodic === undefined
						? Effect.succeed([])
						: readAllPages((after) =>
								executeRyotqlRecipe(
									host.executeRyotql,
									episodic.inventory,
									{ subjectEntityId },
									{ pages: { episodes: { after } } },
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
			value: derived.value,
			changes: derived.changes,
			events: derived.contributions,
			relationships: links.map((relationshipId) => ({ properties, relationshipId })),
		} satisfies FoldValueResult<MediaFoldValue>;
	});

export default defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: foldSubjects({
		update: foldSubject,
		value: MediaFoldValue,
		replay: (subject, host) => foldSubject({ ...subject, changes: null }, host),
	}),
});
