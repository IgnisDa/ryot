import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput, FoldOutput } from "@ryot-app/plugin-backend-sdk/folds";
import { executeRyotqlRecipe, readAllRyotqlPages } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	librarySummaryKind,
	librarySummaryProperties,
	librarySummarySourceRecipe,
} from "../shared/library-summary";
import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "../shared/lifecycle-expressions";
import { consumptionContributions } from "./fold/consumption";
import { absorbFoldValues, deriveHistory, MediaFoldValue } from "./fold/history";
import {
	mediaFoldEventsRecipe,
	mediaFoldInventoryRecipe,
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

export default defineScript({
	manifest,
	input: FoldInput,
	output: FoldOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const subjectEntityId = input.subjectEntityId;
			const subject = yield* executeRyotqlRecipe(
				host.executeRyotql,
				mediaFoldSubjectRecipe({ subjectEntityId }),
			);
			if (!subject) {
				return yield* new MediaSandboxError({ message: "Fold subject is unavailable" });
			}
			const events = yield* readAllRyotqlPages((after) =>
				executeRyotqlRecipe(host.executeRyotql, mediaFoldEventsRecipe({ after, subjectEntityId })),
			);
			const config = [showEpisodicKindConfig, podcastEpisodicKindConfig].find(
				({ parentSchemaSlug }) => parentSchemaSlug === subject.entitySchemaSlug,
			);
			const productionStatus = subject.properties["productionStatus"];
			const { value: previous, renamedKeys } = absorbFoldValues(
				input.value === null
					? { occurrences: [] }
					: yield* Schema.decodeUnknownEffect(MediaFoldValue)(input.value),
				yield* Effect.forEach(input.absorbed, ({ ids, value }) =>
					Schema.decodeUnknownEffect(MediaFoldValue)(value).pipe(
						Effect.map((decoded) => ({ ids, value: decoded })),
					),
				),
			);
			const derived = yield* deriveHistory({
				events,
				previous,
				renamedKeys,
				subject: {
					id: subjectEntityId,
					episodic: config !== undefined,
					terminal:
						typeof productionStatus === "string" &&
						terminalStatuses.has(productionStatus.trim().toLowerCase()),
				},
				inventory:
					config === undefined
						? Effect.succeed([])
						: readAllRyotqlPages((after) =>
								executeRyotqlRecipe(
									host.executeRyotql,
									mediaFoldInventoryRecipe({ after, config, subjectEntityId }),
								),
							).pipe(Effect.map((episodes) => episodes.map(({ id }) => id))),
			});
			const contributions = yield* consumptionContributions(derived);
			const links = yield* executeRyotqlRecipe(
				host.executeRyotql,
				mediaFoldLibraryLinksRecipe({ subjectEntityId }),
			);
			const [summary] =
				links.length === 0
					? []
					: yield* executeRyotqlRecipe(
							host.executeRyotql,
							librarySummarySourceRecipe({
								entityIds: [subjectEntityId],
								kind: librarySummaryKind(subject.entitySchemaSlug),
							}),
						);
			const properties = summary
				? librarySummaryProperties(summary)
				: { lifecycleState: "untracked" };
			return yield* Schema.decodeUnknownEffect(FoldOutput)({
				events: contributions,
				changes: derived.changes,
				relationships: links.map((relationshipId) => ({ properties, relationshipId })),
				value: yield* Schema.encodeEffect(Schema.toCodecJson(MediaFoldValue))(derived.value),
			});
		}),
});
