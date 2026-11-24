import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { UserId } from "@ryot-app/contract/schema/brands";
import { AuthRepository } from "@ryot-app/kernel-backend/modules/accounts/auth/repository";
import { UploadServicesLive } from "@ryot-app/kernel-backend/modules/assets/layer";
import { UploadIntentsService } from "@ryot-app/kernel-backend/modules/assets/uploads/intents";
import { ImportsServiceLive } from "@ryot-app/kernel-backend/modules/imports/layer";
import { ImportsService } from "@ryot-app/kernel-backend/modules/imports/service";
import { MediaHistoryEvent, MediaHistoryItem } from "@ryot-app/media-plugin/shared/media-history";
import { CryptoHasher } from "bun";
import { Clock, Context, Effect, Layer, Schema, Stream } from "effect";

import { historyHandoffTable } from "./history-handoff-sql";
import {
	buildReportSql,
	getLatestReportSequence,
	logReportRows,
	withReservedConnection,
} from "./shared";

const handoffPhase = "history handoff -> import runs";

const mediaHistorySource = "media-history";

// The temporary upload limit is 50 MiB; titles are never split across parts.
const partLimitBytes = 40 * 1024 * 1024;

const StagedRow = Schema.Struct({
	title: Schema.String,
	pluginId: Schema.String,
	event: MediaHistoryEvent,
	externalId: Schema.String,
	providerSlug: Schema.String,
	parentEntityId: Schema.String,
	entitySchemaSlug: Schema.String,
});

export type HistoryPart = { pluginId: string; fileName: string; bytes: Uint8Array };

type StagedRow = typeof StagedRow.Type;

export class LegacyHistoryAdmission extends Context.Service<
	LegacyHistoryAdmission,
	{
		readonly admit: (
			user: CurrentUserValue,
			part: HistoryPart,
		) => Effect.Effect<"admitted" | "source-not-ready">;
	}
>()("@ryot-app/server/migrations/history-handoff/LegacyHistoryAdmission") {}

const encodeItem = Schema.encodeEffect(Schema.fromJsonString(MediaHistoryItem));

const encoder = new TextEncoder();

export const buildHistoryParts = Effect.fn("buildHistoryParts")(function* (
	rows: ReadonlyArray<StagedRow>,
) {
	const items: Array<{
		pluginId: string;
		parentEntityId: string;
		item: MediaHistoryItem & { events: Array<StagedRow["event"]> };
	}> = [];
	for (const row of rows) {
		const current = items.at(-1);
		if (current?.parentEntityId === row.parentEntityId) {
			current.item.events.push(row.event);
			continue;
		}
		items.push({
			pluginId: row.pluginId,
			parentEntityId: row.parentEntityId,
			item: {
				title: row.title,
				events: [row.event],
				externalId: row.externalId,
				providerSlug: row.providerSlug,
				entitySchemaSlug: row.entitySchemaSlug,
			},
		});
	}
	const parts: HistoryPart[] = [];
	let pending: undefined | { size: number; pluginId: string; encoded: string[] };
	const flush = () => {
		if (pending) {
			const bytes = encoder.encode(`[${pending.encoded.join(",")}]`);
			const hash = new CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);
			parts.push({ bytes, pluginId: pending.pluginId, fileName: `media-history-${hash}.json` });
		}
	};
	for (const { item, pluginId } of items) {
		const encoded = yield* encodeItem(item).pipe(Effect.orDie);
		const size = encoder.encode(encoded).length + 1;
		if (pending && (pending.pluginId !== pluginId || pending.size + size > partLimitBytes)) {
			flush();
			pending = undefined;
		}
		pending ??= { size: 1, pluginId, encoded: [] };
		pending.encoded.push(encoded);
		pending.size += size;
	}
	flush();
	return parts;
});

const decodePresence = Schema.decodeUnknownEffect(
	Schema.Array(Schema.Struct({ present: Schema.Boolean })),
);

const decodeUserIds = Schema.decodeUnknownEffect(
	Schema.Array(Schema.Struct({ userId: Schema.String })),
);

const decodeStagedRows = Schema.decodeUnknownEffect(Schema.Array(StagedRow));

const decodeAdmitted = Schema.decodeUnknownEffect(
	Schema.Array(Schema.Struct({ admitted: Schema.Boolean })),
);

const findUserIds = withReservedConnection((connection) =>
	Effect.gen(function* () {
		const [table] = yield* connection
			.execute(
				`SELECT to_regclass('"${historyHandoffTable}"') IS NOT NULL AS "present"`,
				[],
				undefined,
			)
			.pipe(Effect.flatMap(decodePresence));
		if (!table?.present) {
			return null;
		}
		const users = yield* connection
			.execute(
				`SELECT DISTINCT "user_id" AS "userId" FROM "${historyHandoffTable}" ORDER BY "user_id"`,
				[],
				undefined,
			)
			.pipe(Effect.flatMap(decodeUserIds));
		return users.map(({ userId }) => userId);
	}).pipe(Effect.orDie),
);

const readStagedRows = (userId: string) =>
	withReservedConnection((connection) =>
		connection
			.execute(
				`SELECT "plugin_id" AS "pluginId", "parent_entity_id" AS "parentEntityId", "title",
					"external_id" AS "externalId", "provider_slug" AS "providerSlug",
					"entity_schema_slug" AS "entitySchemaSlug", "event"
				FROM "${historyHandoffTable}" WHERE "user_id" = $1
				ORDER BY "parent_entity_id", "legacy_kind" DESC, "legacy_record_id"`,
				[userId],
				undefined,
			)
			.pipe(Effect.flatMap(decodeStagedRows), Effect.orDie),
	);

// A run without a plan never finished admission; recovery aborts it, so the part is admitted again.
const isPartAdmitted = (userId: string, fileName: string) =>
	withReservedConnection((connection) =>
		Effect.gen(function* () {
			const [row] = yield* connection
				.execute(
					`SELECT EXISTS (
						SELECT 1 FROM "import_run"
						WHERE "user_id" = $1 AND "source" = $2 AND "plan" IS NOT NULL
							AND "input_summary" -> 'fileNames' ->> 'uploadToken' = $3
					) AS "admitted"`,
					[userId, mediaHistorySource, fileName],
					undefined,
				)
				.pipe(Effect.flatMap(decodeAdmitted), Effect.orDie);
			return row?.admitted === true;
		}),
	);

export const handOffLegacyHistory = Effect.gen(function* () {
	const userIds = yield* findUserIds;
	if (userIds === null) {
		return;
	}
	const startedAtMs = yield* Clock.currentTimeMillis;
	const admission = yield* LegacyHistoryAdmission;
	const users = yield* AuthRepository;
	let runs = 0;
	let skippedUsers = 0;
	for (const userId of userIds) {
		const user = yield* users.findUserById(userId).pipe(Effect.orDie);
		if (user?.disabledAt !== null) {
			skippedUsers++;
			continue;
		}
		const currentUser = {
			name: user.name,
			email: user.email,
			image: user.image,
			id: UserId.make(user.id),
			preferences: user.preferences,
		};
		for (const part of yield* buildHistoryParts(yield* readStagedRows(userId))) {
			runs++;
			if (yield* isPartAdmitted(userId, part.fileName)) {
				continue;
			}
			if ((yield* admission.admit(currentUser, part)) === "source-not-ready") {
				yield* Effect.logWarning(
					"Handed-off legacy history waits for the Media history import to be ready; configure the Media plugin's providers, then restart the server",
				);
				return;
			}
		}
	}
	const elapsedSeconds = ((yield* Clock.currentTimeMillis) - startedAtMs) / 1000;
	yield* withReservedConnection((connection) =>
		Effect.gen(function* () {
			const reportSequence = yield* getLatestReportSequence(connection);
			yield* connection.executeRaw(
				`DO $$
				DECLARE started_at timestamptz := clock_timestamp() - make_interval(secs => ${elapsedSeconds});
				BEGIN
					${buildReportSql(handoffPhase, [
						{ count: String(runs), message: "Media history import run(s) hold handed-off records" },
						...(skippedUsers > 0
							? [
									{
										count: String(skippedUsers),
										message:
											"user(s) disabled or deleted before admission keep their handed-off records unimported",
									},
								]
							: []),
					])}
					DROP TABLE "${historyHandoffTable}";
				END $$;`,
				[],
			);
			yield* logReportRows(connection, reportSequence);
		}),
	);
});

const LegacyHistoryAdmissionLive = Layer.effect(
	LegacyHistoryAdmission,
	Effect.gen(function* () {
		const imports = yield* ImportsService;
		const uploads = yield* UploadIntentsService;
		return {
			admit: Effect.fn("LegacyHistoryAdmission.admit")(
				function* (user: CurrentUserValue, part: HistoryPart) {
					const contentType = "application/json";
					const intent = yield* uploads.createUploadIntent(user, {
						contentType,
						kind: "temporary",
						fileName: part.fileName,
					});
					yield* uploads.putLocalIntent(
						intent.intentId,
						intent.method,
						intent.uploadUrl,
						contentType,
						String(part.bytes.length),
						Stream.make(part.bytes),
					);
					const completion = yield* uploads.completeUploadIntent(user, intent.intentId);
					if (!("token" in completion)) {
						return yield* Effect.die(new Error("A temporary upload completed without a token"));
					}
					const admitted = yield* imports
						.startImportRun(user, {
							uploadToken: completion.token,
							source: { slug: mediaHistorySource, owner: definitionOwner(part.pluginId) },
						})
						.pipe(
							Effect.as("admitted" as const),
							Effect.catchTag("ImportRequestError", (error) =>
								error.reason.code === "source-not-ready"
									? Effect.succeed("source-not-ready" as const)
									: Effect.fail(error),
							),
						);
					return admitted;
				},
				Effect.mapError(
					(cause) =>
						new Error(
							`history handoff -> import runs: a Media history import run could not be admitted, so the handed-off watches and reviews stay staged in "${historyHandoffTable}". Fix the cause below and restart the server; admitted runs are not admitted again.`,
							{ cause },
						),
				),
				Effect.orDie,
			),
		};
	}),
).pipe(Layer.provide(Layer.merge(ImportsServiceLive, UploadServicesLive)));

export const LegacyHistoryHandoffLive = Layer.effectDiscard(handOffLegacyHistory).pipe(
	Layer.provide(Layer.merge(LegacyHistoryAdmissionLive, AuthRepository.layer)),
);
