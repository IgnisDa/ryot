import type {
	ListedNotificationChannel,
	NotificationChannelSpecifics,
	UpdateNotificationChannelBody,
} from "@ryot/contract/modules/notifications/schemas";
import type { NotificationChannelKind } from "@ryot/contract/modules/notifications/types";
import { NotificationChannelId, UserId } from "@ryot/contract/schema/brands";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Match, Option } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export type NotificationChannelRecord = ListedNotificationChannel & {
	readonly userId: UserId;
	readonly channelSpecifics: NotificationChannelSpecifics;
};

type NotificationChannelRow = typeof schema.notificationChannel.$inferSelect;

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

export const describeNotificationChannel = (specifics: NotificationChannelSpecifics) =>
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

const toRecord = (row: NotificationChannelRow): NotificationChannelRecord => {
	const channelSpecifics = row.channelSpecifics;
	return {
		channelSpecifics,
		channel: row.channel,
		isDisabled: row.isDisabled,
		userId: UserId.make(row.userId),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		id: NotificationChannelId.make(row.id),
		description: describeNotificationChannel(channelSpecifics),
	};
};

const toListed = ({
	channelSpecifics: _channelSpecifics,
	userId: _userId,
	...record
}: NotificationChannelRecord) => record;

const ownedChannelWhere = (input: { channelId: NotificationChannelId; userId: UserId }) =>
	and(
		eq(schema.notificationChannel.id, input.channelId),
		eq(schema.notificationChannel.userId, input.userId),
	);

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
						.from(schema.notificationChannel)
						.where(eq(schema.notificationChannel.userId, userId))
						.orderBy(desc(schema.notificationChannel.createdAt)),
				);
				return rows.map(toRecord).map(toListed);
			});

			const createForUser = Effect.fn("NotificationsRepository.createForUser")(function* (input: {
				userId: UserId;
				isDisabled: boolean;
				channel: NotificationChannelKind;
				channelSpecifics: NotificationChannelSpecifics;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.notificationChannel)
						.values({
							userId: input.userId,
							channel: input.channel,
							isDisabled: input.isDisabled,
							channelSpecifics: input.channelSpecifics,
						})
						.returning(),
				);
				return row
					? toRecord(row)
					: yield* Effect.die("Notification channel insert returned no row");
			});

			const getForUser = Effect.fn("NotificationsRepository.getForUser")(function* (input: {
				userId: UserId;
				channelId: NotificationChannelId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db.select().from(schema.notificationChannel).where(ownedChannelWhere(input)).limit(1),
				);
				return row ? toRecord(row) : null;
			});

			const updateForUser = Effect.fn("NotificationsRepository.updateForUser")(function* (input: {
				userId: UserId;
				channelId: NotificationChannelId;
				body: UpdateNotificationChannelBody;
			}) {
				const db = yield* CurrentDb;
				const updates: Partial<typeof schema.notificationChannel.$inferInsert> = {};
				if (input.body.isDisabled !== undefined) {
					updates.isDisabled = input.body.isDisabled;
				}

				if (Object.keys(updates).length === 0) {
					const existing = yield* getForUser(input);
					return existing ? toListed(existing) : null;
				}

				const [row] = yield* dbEffect(() =>
					db
						.update(schema.notificationChannel)
						.set(updates)
						.where(ownedChannelWhere(input))
						.returning(),
				);
				return row ? toListed(toRecord(row)) : null;
			});

			const deleteForUser = Effect.fn("NotificationsRepository.deleteForUser")(function* (input: {
				userId: UserId;
				channelId: NotificationChannelId;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.delete(schema.notificationChannel)
						.where(ownedChannelWhere(input))
						.returning({ id: schema.notificationChannel.id }),
				);
				return rows.length > 0;
			});

			const listEnabledForUser = Effect.fn("NotificationsRepository.listEnabledForUser")(
				function* (input: { userId: UserId }) {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select()
							.from(schema.notificationChannel)
							.where(
								and(
									eq(schema.notificationChannel.userId, input.userId),
									eq(schema.notificationChannel.isDisabled, false),
								),
							)
							.orderBy(desc(schema.notificationChannel.createdAt)),
					);
					return rows.map(toRecord);
				},
			);

			return {
				listForUser,
				createForUser,
				deleteForUser,
				updateForUser,
				listEnabledForUser,
			};
		},
	},
) {}
