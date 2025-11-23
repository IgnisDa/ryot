import type {
	ListedNotificationPlatform,
	NotificationPlatformSpecifics,
	UpdateNotificationPlatformBody,
} from "@ryot/contract/modules/notifications/schemas";
import type {
	NotificationEventType,
	NotificationPlatformKind,
} from "@ryot/contract/modules/notifications/types";
import { NotificationPlatformId, UserId } from "@ryot/contract/schema/brands";
import { and, desc, eq, sql } from "drizzle-orm";
import { Effect, Match, Option } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export type NotificationPlatformRecord = ListedNotificationPlatform & {
	readonly userId: UserId;
	readonly platformSpecifics: NotificationPlatformSpecifics;
};

type NotificationPlatformRow = typeof schema.notificationPlatform.$inferSelect;

const urlOrigin = Option.liftThrowable((value: string) => new URL(value).origin);

const safeUrlOrigin = (value: string) =>
	urlOrigin(value).pipe(Option.getOrElse(() => "configured endpoint"));

const maskEmail = (value: string) => {
	const [local, domain] = value.split("@");
	if (!local || !domain) {
		return "configured recipient";
	}
	return `${local[0]}***@${domain}`;
};

const maskChatId = (value: string) => `chat ending in ${value.slice(-4)}`;

export const describeNotificationPlatform = (specifics: NotificationPlatformSpecifics) =>
	Match.value(specifics).pipe(
		Match.when({ kind: "apprise" }, ({ baseUrl }) => `Apprise at ${safeUrlOrigin(baseUrl)}`),
		Match.when(
			{ kind: "discord" },
			({ webhookUrl }) => `Discord webhook at ${safeUrlOrigin(webhookUrl)}`,
		),
		Match.when({ kind: "email" }, ({ recipient }) => `Email to ${maskEmail(recipient)}`),
		Match.when({ kind: "gotify" }, ({ baseUrl }) => `Gotify at ${safeUrlOrigin(baseUrl)}`),
		Match.when(
			{ kind: "ntfy" },
			({ baseUrl }) => `ntfy at ${safeUrlOrigin(baseUrl ?? "https://ntfy.sh")}`,
		),
		Match.when({ kind: "push_bullet" }, () => "PushBullet configured"),
		Match.when({ kind: "push_over" }, () => "PushOver configured"),
		Match.when({ kind: "push_safer" }, () => "PushSafer configured"),
		Match.when({ kind: "telegram" }, ({ chatId }) => `Telegram ${maskChatId(chatId)}`),
		Match.exhaustive,
	);

const toRecord = (row: NotificationPlatformRow): NotificationPlatformRecord => {
	const platformSpecifics = row.platformSpecifics;
	return {
		platformSpecifics,
		platform: row.platform,
		isDisabled: row.isDisabled,
		userId: UserId.make(row.userId),
		configuredEvents: row.configuredEvents,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		id: NotificationPlatformId.make(row.id),
		description: describeNotificationPlatform(platformSpecifics),
	};
};

const toListed = ({
	platformSpecifics: _platformSpecifics,
	userId: _userId,
	...record
}: NotificationPlatformRecord) => record;

export class NotificationsRepository extends Effect.Service<NotificationsRepository>()(
	"NotificationsRepository",
	{
		sync: () => {
			const listForUser = Effect.fn("NotificationsRepository.listForUser")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationPlatform)
						.where(eq(schema.notificationPlatform.userId, userId))
						.orderBy(desc(schema.notificationPlatform.createdAt)),
				);
				return rows.map(toRecord).map(toListed);
			});

			const createForUser = Effect.fn("NotificationsRepository.createForUser")(function* (input: {
				userId: UserId;
				isDisabled: boolean;
				platform: NotificationPlatformKind;
				configuredEvents: NotificationEventType[];
				platformSpecifics: NotificationPlatformSpecifics;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.notificationPlatform)
						.values({
							userId: input.userId,
							platform: input.platform,
							isDisabled: input.isDisabled,
							configuredEvents: input.configuredEvents,
							platformSpecifics: input.platformSpecifics,
						})
						.returning(),
				);
				return row
					? toRecord(row)
					: yield* Effect.die("Notification platform insert returned no row");
			});

			const getForUser = Effect.fn("NotificationsRepository.getForUser")(function* (input: {
				userId: UserId;
				platformId: NotificationPlatformId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationPlatform)
						.where(
							and(
								eq(schema.notificationPlatform.id, input.platformId),
								eq(schema.notificationPlatform.userId, input.userId),
							),
						)
						.limit(1),
				);
				return row ? toRecord(row) : null;
			});

			const updateForUser = Effect.fn("NotificationsRepository.updateForUser")(function* (input: {
				userId: UserId;
				platformId: NotificationPlatformId;
				body: UpdateNotificationPlatformBody;
			}) {
				const db = yield* CurrentDb;
				const updates: Partial<typeof schema.notificationPlatform.$inferInsert> = {};
				if (input.body.isDisabled !== undefined) {
					updates.isDisabled = input.body.isDisabled;
				}
				if (input.body.configuredEvents !== undefined) {
					updates.configuredEvents = [...input.body.configuredEvents];
				}

				if (Object.keys(updates).length === 0) {
					return yield* getForUser(input);
				}

				const [row] = yield* dbEffect(() =>
					db
						.update(schema.notificationPlatform)
						.set(updates)
						.where(
							and(
								eq(schema.notificationPlatform.id, input.platformId),
								eq(schema.notificationPlatform.userId, input.userId),
							),
						)
						.returning(),
				);
				return row ? toRecord(row) : null;
			});

			const deleteForUser = Effect.fn("NotificationsRepository.deleteForUser")(function* (input: {
				userId: UserId;
				platformId: NotificationPlatformId;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.delete(schema.notificationPlatform)
						.where(
							and(
								eq(schema.notificationPlatform.id, input.platformId),
								eq(schema.notificationPlatform.userId, input.userId),
							),
						)
						.returning({ id: schema.notificationPlatform.id }),
				);
				return rows.length > 0;
			});

			const listEnabledForUser = Effect.fn("NotificationsRepository.listEnabledForUser")(
				function* (input: { userId: UserId; eventType?: NotificationEventType }) {
					const db = yield* CurrentDb;
					const clauses = [
						eq(schema.notificationPlatform.userId, input.userId),
						eq(schema.notificationPlatform.isDisabled, false),
					];
					if (input.eventType !== undefined) {
						clauses.push(
							sql<boolean>`${input.eventType} = ANY(${schema.notificationPlatform.configuredEvents})`,
						);
					}

					const rows = yield* dbEffect(() =>
						db
							.select()
							.from(schema.notificationPlatform)
							.where(and(...clauses))
							.orderBy(desc(schema.notificationPlatform.createdAt)),
					);
					return rows.map(toRecord);
				},
			);

			return {
				getForUser,
				listForUser,
				createForUser,
				deleteForUser,
				updateForUser,
				listEnabledForUser,
			};
		},
	},
) {}
