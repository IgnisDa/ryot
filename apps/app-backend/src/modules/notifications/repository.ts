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
	readonly specifics: NotificationChannelSpecifics;
};

type NotificationChannelRow = typeof schema.notificationChannel.$inferSelect;

const urlOrigin = Option.liftThrowable((value: string) => new URL(value).origin);
const safeUrlOrigin = (value: string) =>
	urlOrigin(value).pipe(Option.getOrElse(() => "configured endpoint"));

const maskEmail = (value: string) => {
	const [local, domain] = value.split("@");
	return local && domain ? `${local[0]}***@${domain}` : "configured recipient";
};

const maskChatId = (value: string) => `chat ending in ${value.slice(-4)}`;

const describeNotificationChannel = (specifics: NotificationChannelSpecifics) =>
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

const toRecord = (row: NotificationChannelRow): NotificationChannelRecord => ({
	kind: row.kind,
	specifics: row.specifics,
	isDisabled: row.isDisabled,
	userId: UserId.make(row.userId),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	id: NotificationChannelId.make(row.id),
	description: describeNotificationChannel(row.specifics),
});

const toListed = ({
	specifics: _specifics,
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
				kind: NotificationChannelKind;
				specifics: NotificationChannelSpecifics;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db.insert(schema.notificationChannel).values(input).returning(),
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
				if (input.body.isDisabled === undefined) {
					const existing = yield* getForUser(input);
					return existing ? toListed(existing) : null;
				}
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.notificationChannel)
						.set({ isDisabled: input.body.isDisabled })
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

			const listEnabledForUser = Effect.fn("NotificationsRepository.listEnabledForUser")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationChannel)
						.where(
							and(
								eq(schema.notificationChannel.userId, userId),
								eq(schema.notificationChannel.isDisabled, false),
							),
						)
						.orderBy(desc(schema.notificationChannel.createdAt)),
				);
				return rows.map(toRecord);
			});

			return { createForUser, deleteForUser, listEnabledForUser, listForUser, updateForUser };
		},
	},
) {}
