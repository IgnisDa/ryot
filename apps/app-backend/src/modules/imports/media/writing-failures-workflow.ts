import { Activity } from "@effect/workflow";
import { Effect } from "effect";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import type { ImportMediaEntityGroup } from "./types";

export const recordWriteFailure = (input: {
	name: string;
	itemIndex: number;
	message: string;
	eventSchemaSlug?: string;
	entitySchemaSlug?: string;
	ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	payload: Pick<ImportRunJobData, "runId">;
}) =>
	Activity.make({
		error: ImportRunError,
		name: input.name,
		execute: recordImportRunFailure({
			context: null,
			stage: "database_commit",
			runId: input.payload.runId,
			itemIndex: input.itemIndex,
			message: input.message,
			sourceLabel: input.ref.sourceLabel,
			sourceIdentifier: input.ref.externalId,
			eventSchemaSlug: input.eventSchemaSlug,
			entitySchemaSlug: input.entitySchemaSlug ?? input.ref.entitySchemaSlug,
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const recordEpisodeSchemaMissing = (input: {
	i: number;
	itemIndex: number;
	eventIndex: number;
	entitySchemaSlug: string;
	ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	payload: Pick<ImportRunJobData, "runId">;
}) =>
	recordWriteFailure({
		ref: input.ref,
		itemIndex: input.itemIndex,
		payload: input.payload,
		entitySchemaSlug: input.entitySchemaSlug,
		name: `record-${input.entitySchemaSlug}-schema-missing-${input.i}-${input.eventIndex}`,
		message: `Entity schema not found: ${input.entitySchemaSlug}`,
	});

export const recordEpisodeResolutionFailure = (input: {
	i: number;
	eventIndex: number;
	itemIndex: number;
	event: ImportMediaEntityGroup["events"][number];
	ref: Extract<ImportMediaEntityGroup["entityRef"], { kind: "resolved" }>;
	payload: Pick<ImportRunJobData, "runId">;
}) => {
	const locator = input.event.episodeLocator;
	const isShow = locator?.type === "show";

	return Activity.make({
		error: ImportRunError,
		name: `record-${isShow ? "show" : "podcast"}-episode-resolution-failure-${input.i}-${input.eventIndex}`,
		execute: recordImportRunFailure({
			runId: input.payload.runId,
			itemIndex: input.itemIndex,
			stage: "provider_resolution",
			sourceLabel: input.ref.sourceLabel,
			sourceIdentifier: input.ref.externalId,
			eventSchemaSlug: input.event.eventSchemaSlug,
			entitySchemaSlug: input.ref.entitySchemaSlug,
			context:
				locator?.type === "show"
					? { episodeNumber: locator.episodeNumber, seasonNumber: locator.seasonNumber }
					: { episodeNumber: locator?.episodeNumber },
			message:
				locator?.type === "show"
					? `Could not resolve show episode S${locator.seasonNumber}E${locator.episodeNumber}`
					: `Could not resolve podcast episode ${locator?.episodeNumber}`,
		}).pipe(Effect.mapError(toWorkflowError)),
	});
};
