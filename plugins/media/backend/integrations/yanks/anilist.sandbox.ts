import type { ExecutionMetadata, ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";

import { ListStatePropertiesSchema, type ListStateProperties } from "../../../shared/list-state";
import { listStateSnapshotsRecipe } from "../../../shared/list-state-recipes";
import { readMediaCapture } from "../../imports/collection";
import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { MediaSandboxError } from "../../lib/failures";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { executionStartedAt } from "../shared";
import type { AniListMediaType } from "./anilist";
import {
	AniListCarry,
	AniListCollectionData,
	AniListGraphQLResponse,
	AniListViewerData,
	anilistEntryIdentity,
	anilistEntryMediaId,
	anilistEntryLabel,
	parseAniListEntry,
	sameAniListState,
} from "./anilist";

export const manifest = defineManifest({
	kind: "script",
	name: "AniList yank",
	slug: "integration.anilist",
});

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const ANILIST_PAGE_SIZE = 100;
const AniListSettings = Schema.Struct({
	account: Schema.NonEmptyString,
	syncAnime: Schema.optional(Schema.Boolean),
	syncManga: Schema.optional(Schema.Boolean),
});
const HttpFailure = Schema.Struct({
	data: Schema.optional(Schema.Struct({ status: Schema.optional(Schema.Finite) })),
});

const viewerQuery = "query { Viewer { id } }";
const mediaListCollectionQuery = `query ($userId: Int!, $type: MediaType!, $chunk: Int!, $perChunk: Int!) {
	MediaListCollection(
		userId: $userId
		type: $type
		chunk: $chunk
		perChunk: $perChunk
		forceSingleCompletedList: true
		sort: [MEDIA_ID]
	) {
		hasNextChunk
		lists {
			entries {
				id
				mediaId
				status
				progress
				progressVolumes
				repeat
				updatedAt
				startedAt { year month day }
				completedAt { year month day }
				media { title { userPreferred } }
			}
		}
	}
}`;

const encodeRequest = Schema.encodeSync(
	Schema.fromJsonString(
		Schema.Struct({
			query: Schema.String,
			variables: Schema.optional(
				Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite])),
			),
		}),
	),
);

type AniListHost = Pick<
	ScriptHost,
	| "executeRyotql"
	| "getCurrentIntegration"
	| "getOAuthAccessToken"
	| "httpCall"
	| "invalidateOAuthAccessToken"
>;

const httpFailureStatus = (error: unknown) => {
	const decoded = Schema.decodeUnknownOption(HttpFailure)(error);
	return Option.isSome(decoded) ? decoded.value.data?.status : undefined;
};

const requestFailure = (status?: number) =>
	new MediaSandboxError({
		message:
			status === undefined
				? "AniList GraphQL request failed"
				: `AniList GraphQL request returned status ${status}`,
	});

const requestAniList = Effect.fn("AniList.request")(function* (
	host: AniListHost,
	accessToken: string,
	query: string,
	variables?: Record<string, string | number>,
) {
	const response = yield* host
		.httpCall("POST", ANILIST_GRAPHQL_URL, {
			body: encodeRequest({ query, ...(variables ? { variables } : {}) }),
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
		})
		.pipe(
			Effect.catch((error) =>
				Effect.gen(function* () {
					const status = httpFailureStatus(error);
					if (status === 401) {
						yield* host.invalidateOAuthAccessToken({ accessToken, field: "account" });
					}
					return yield* requestFailure(status);
				}),
			),
		);
	if (response.status < 200 || response.status >= 300) {
		if (response.status === 401) {
			yield* host.invalidateOAuthAccessToken({ accessToken, field: "account" });
		}
		return yield* requestFailure(response.status);
	}
	const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(AniListGraphQLResponse))(
		response.body,
	).pipe(Effect.mapError(() => requestFailure()));
	if (envelope.errors?.length) {
		const status =
			envelope.errors.find((error) => error.status === 401)?.status ??
			envelope.errors.find((error) => error.status !== undefined)?.status;
		if (status === 401) {
			yield* host.invalidateOAuthAccessToken({ accessToken, field: "account" });
		}
		return yield* requestFailure(status);
	}
	if (envelope.data === undefined || envelope.data === null) {
		return yield* requestFailure();
	}
	return envelope.data;
});

const readLatestSnapshots = Effect.fn("AniList.readLatestSnapshots")(function* (
	host: AniListHost,
	sourceAccountId: string,
	sourceEntryIds: readonly string[],
) {
	const latest = new Map<string, ListStateProperties>();
	const cursors = new Set<string>();
	const requested = new Set(sourceEntryIds);
	let after: string | undefined;
	for (;;) {
		const page = yield* executeRyotqlRecipe(
			host.executeRyotql,
			listStateSnapshotsRecipe({
				...(after === undefined ? {} : { after }),
				sourceEntryIds,
				sourceAccountId,
				limit: ANILIST_PAGE_SIZE,
			}),
		);
		for (const snapshot of page.items) {
			if (
				requested.has(snapshot.properties.sourceEntryId) &&
				!latest.has(snapshot.properties.sourceEntryId)
			) {
				latest.set(snapshot.properties.sourceEntryId, snapshot.properties);
			}
		}
		const nextCursor = page.pageInfo.nextCursor;
		if (latest.size === sourceEntryIds.length || !page.pageInfo.hasMore || nextCursor === null) {
			break;
		}
		if (cursors.has(nextCursor)) {
			return yield* new MediaSandboxError({
				message: "AniList snapshot lookup returned an invalid cursor",
			});
		}
		cursors.add(nextCursor);
		after = nextCursor;
	}
	return latest;
});

const stateVersion = Schema.encodeSync(Schema.fromJsonString(ListStatePropertiesSchema));

const runAniListYank = Effect.fn("AniList.collect")(function* (
	input: typeof YankInput.Type,
	host: AniListHost,
	execution: ExecutionMetadata,
) {
	if (input.ingestionConfirmation) {
		return { chunkFiles: [], carryFile: null };
	}
	const integration = yield* host.getCurrentIntegration();
	const settings = yield* Schema.decodeUnknownEffect(AniListSettings)(
		integration.providerSpecifics,
	).pipe(
		Effect.mapError(
			() => new MediaSandboxError({ message: "AniList integration settings are invalid" }),
		),
	);
	let cursor: typeof AniListCarry.Type;
	let accessToken: string;
	if (input.ingestionArtifacts) {
		const carry = yield* readMediaCapture("carry");
		cursor = yield* Schema.decodeEffect(Schema.fromJsonString(AniListCarry))(
			new TextDecoder().decode(carry),
		).pipe(
			Effect.mapError(
				() => new MediaSandboxError({ message: "AniList continuation state is invalid" }),
			),
		);
		if (cursor.accountConnectionId !== settings.account) {
			return yield* new MediaSandboxError({
				message: "AniList account connection changed during collection",
			});
		}
		({ accessToken } = yield* host.getOAuthAccessToken({ field: "account" }));
	} else {
		const mediaTypes: Array<typeof AniListMediaType.Type> = [];
		if (settings.syncAnime !== false) {
			mediaTypes.push("ANIME");
		}
		if (settings.syncManga !== false) {
			mediaTypes.push("MANGA");
		}
		const mediaType = mediaTypes[0];
		if (!mediaType) {
			return yield* captureIntegrationWindow(
				manifest.slug,
				{ failures: [], entityGroups: [] },
				null,
			);
		}
		const startedAt = yield* executionStartedAt(execution);
		const observation = DateTime.make(startedAt);
		if (Option.isNone(observation)) {
			return yield* new MediaSandboxError({ message: "AniList execution start time is invalid" });
		}
		({ accessToken } = yield* host.getOAuthAccessToken({ field: "account" }));
		const viewerData = yield* requestAniList(host, accessToken, viewerQuery);
		const viewer = yield* Schema.decodeUnknownEffect(AniListViewerData)(viewerData).pipe(
			Effect.mapError(() => requestFailure()),
		);
		cursor = {
			chunk: 1,
			mediaType,
			sourceIndex: 0,
			nextMediaType: mediaTypes[1] ?? null,
			accountConnectionId: settings.account,
			sourceAccountId: String(viewer.Viewer.id),
			observationAt: DateTime.formatIso(observation.value),
		};
	}
	const userId = Number(cursor.sourceAccountId);
	if (!Number.isSafeInteger(userId) || userId <= 0) {
		return yield* requestFailure();
	}
	const collectionData = yield* requestAniList(host, accessToken, mediaListCollectionQuery, {
		userId,
		chunk: cursor.chunk,
		type: cursor.mediaType,
		perChunk: ANILIST_PAGE_SIZE,
	});
	const collection = yield* Schema.decodeUnknownEffect(AniListCollectionData)(collectionData).pipe(
		Effect.mapError(() => requestFailure()),
	);
	const identityById = new Map<number, { readonly mediaId: number; readonly value: unknown }>();
	for (const list of collection.MediaListCollection.lists) {
		for (const value of list.entries) {
			const identity = anilistEntryIdentity(value);
			if (Option.isNone(identity)) {
				return yield* new MediaSandboxError({
					message: "AniList list collection contains an entry without a valid id",
				});
			}
			if (!identityById.has(identity.value.id)) {
				identityById.set(identity.value.id, {
					value,
					mediaId: anilistEntryMediaId(value, identity.value.id),
				});
			}
		}
	}
	const entries = [...identityById.entries()].sort(
		([leftId, left], [rightId, right]) => left.mediaId - right.mediaId || leftId - rightId,
	);
	const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
	const pending: Array<{
		readonly itemIndex: number;
		readonly mediaId: number;
		readonly sourceEntryId: string;
		readonly sourceLabel: string;
		readonly properties: ListStateProperties;
	}> = [];
	let sourceIndex = cursor.sourceIndex;
	for (const [entryId, { value }] of entries) {
		const itemIndex = sourceIndex++;
		const sourceIdentifier = String(entryId);
		const sourceLabel = anilistEntryLabel(value, entryId);
		const parsed = parseAniListEntry(value, {
			mediaType: cursor.mediaType,
			sourceAccountId: cursor.sourceAccountId,
		});
		if (Option.isNone(parsed)) {
			failures.push({
				itemIndex,
				sourceLabel,
				sourceIdentifier,
				stage: "input_transformation",
				message: "AniList list entry is malformed",
				entitySchemaSlug: cursor.mediaType === "ANIME" ? "anime" : "manga",
			});
			continue;
		}
		pending.push({
			itemIndex,
			sourceLabel,
			sourceEntryId: sourceIdentifier,
			mediaId: parsed.value.entry.mediaId,
			properties: parsed.value.properties,
		});
	}
	const previousStates = pending.length
		? yield* readLatestSnapshots(
				host,
				cursor.sourceAccountId,
				pending.map(({ sourceEntryId }) => sourceEntryId),
			)
		: new Map<string, ListStateProperties>();
	const entitySchemaSlug = cursor.mediaType === "ANIME" ? "anime" : "manga";
	const providerSlug = `${entitySchemaSlug}.anilist`;
	const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
	for (const entry of pending) {
		const previous = previousStates.get(entry.sourceEntryId);
		if (previous && sameAniListState(previous, entry.properties)) {
			continue;
		}
		const stateIdentity = stateVersion(entry.properties);
		entityGroups.push({
			collectionMemberships: [],
			itemIndex: entry.itemIndex,
			entityRef: {
				providerSlug,
				entitySchemaSlug,
				kind: "resolved",
				sourceLabel: entry.sourceLabel,
				externalId: String(entry.mediaId),
			},
			events: [
				{
					eventSchemaSlug: "list-state",
					occurredAt: cursor.observationAt,
					operationId: integrationRecordId([
						"integration-source-event",
						"anilist",
						cursor.sourceAccountId,
						entry.sourceEntryId,
						entry.properties.sourceUpdatedAt,
						stateIdentity,
					]),
					properties: yield* Schema.decodeUnknownEffect(
						Schema.Record(Schema.String, jsonValueSchema),
					)(
						yield* Schema.encodeEffect(Schema.toCodecJson(ListStatePropertiesSchema))(
							entry.properties,
						),
					),
					attribution: {
						sourceLabel: entry.sourceLabel,
						sourceIdentifier: entry.sourceEntryId,
						recordId: integrationRecordId([
							"anilist-list-state",
							cursor.sourceAccountId,
							entry.sourceEntryId,
						]),
					},
				},
			],
		});
	}
	let next: typeof AniListCarry.Type | null = null;
	if (collection.MediaListCollection.hasNextChunk) {
		next = { ...cursor, sourceIndex, chunk: cursor.chunk + 1 };
	} else if (cursor.nextMediaType) {
		next = {
			...cursor,
			chunk: 1,
			sourceIndex,
			nextMediaType: null,
			mediaType: cursor.nextMediaType,
		};
	}
	return yield* captureIntegrationWindow(
		manifest.slug,
		{ failures, entityGroups },
		next ? yield* Schema.encodeEffect(Schema.fromJsonString(AniListCarry))(next) : null,
		cursor.sourceIndex,
	);
});

export default defineScript({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host, execution) => runAniListYank(input, host, execution),
});
