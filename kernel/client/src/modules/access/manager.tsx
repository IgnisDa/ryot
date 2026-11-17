import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, EmptyState, EntitlementNotice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ApiKeyItem } from "@ryot-app/ryotql-recipes/api-keys";
import { type ReactNode, useRef, useState } from "react";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { useEntitlement } from "#/modules/entitlements/context";
import { formatRelativeTime } from "#/modules/ui/run/run-status";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { CredentialList } from "./credential-list";
import {
	apiKeysQuery,
	connectedAppsQuery,
	revokeApiKeyMutation,
	revokeConnectedAppMutation,
} from "./service";
import { writeAccessLabel } from "./write-access";

const EXPIRING_SOON_MS = 7 * 86_400_000;

const KEY_MASK = "••••••••";

const lastUsed = (
	formatters: Formatters,
	t: (message: Message) => Text,
	value: null | string,
	now: number,
) =>
	value === null
		? kernelMessage("client.access.credentials.never-used")
		: kernelMessage("client.access.credentials.last-used", {
				when: formatRelativeTime(formatters, t, value, now),
			});

export function AccessManager(props: { readonly isDemo: boolean }) {
	const t = useT();
	const createTrigger = useRef<null | HTMLButtonElement>(null);
	const [creating, setCreating] = useState(false);
	const pro = useEntitlement("pro");
	const intro = (
		<p className="text-sm text-text-muted">{t(kernelMessage("client.access.intro"))}</p>
	);

	if (props.isDemo) {
		return (
			<div className="flex flex-col gap-6">
				{intro}
				<DemoProtectionMessage />
			</div>
		);
	}

	const openCreate = (trigger: HTMLButtonElement) => {
		createTrigger.current = trigger;
		setCreating(true);
	};

	return (
		<div className="flex flex-col gap-8">
			{intro}
			<AccessSection
				title={t(kernelMessage("client.access.apps.title"))}
				description={t(kernelMessage("client.access.apps.description"))}
			>
				{pro ? null : (
					<EntitlementNotice
						entitlement="pro"
						icon={<AppIcon size={16} name="sparkles" />}
						detail={t(kernelMessage("client.access.apps.pro-required"))}
					/>
				)}
				<ConnectedAppsList />
			</AccessSection>
			<AccessSection
				title={t(kernelMessage("client.access.keys.title"))}
				description={t(kernelMessage("client.access.keys.description"))}
				action={
					<Button
						className="shrink-0 self-start sm:self-center"
						onClick={(event) => openCreate(event.currentTarget)}
					>
						<AppIcon size={16} name="plus" />
						{t(kernelMessage("client.access.create.submit"))}
					</Button>
				}
			>
				{pro ? null : (
					<EntitlementNotice
						entitlement="pro"
						icon={<AppIcon size={16} name="key-round" />}
						detail={t(kernelMessage("client.access.keys.pro-required"))}
					/>
				)}
				<ApiKeysList onCreate={openCreate} />
			</AccessSection>
			{creating ? (
				<CreateApiKeyDialog triggerRef={createTrigger} onClose={() => setCreating(false)} />
			) : null}
		</div>
	);
}

function AccessSection(props: {
	readonly title: Text;
	readonly description: Text;
	readonly action?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<section aria-label={props.title} className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
				<div className="grid flex-1 gap-1">
					<h2 className="text-base font-semibold text-text">{props.title}</h2>
					<p className="text-sm text-text-muted">{props.description}</p>
				</div>
				{props.action}
			</div>
			{props.children}
		</section>
	);
}

function ConnectedAppsList() {
	const t = useT();
	const formatters = useFormatters();
	const now = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const revoke = useRyotMutation(revokeConnectedAppMutation);
	const query = useRyotInfiniteQuery(connectedAppsQuery, undefined, {
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		getPageInput: (_, after: string | undefined) => after,
	});
	const apps = paginationItems(
		query.pages,
		(page) => page.items,
		(app) => app.id,
	);
	return (
		<CredentialList
			isError={query.isError}
			isPending={query.isPending}
			onRetry={() => query.refetch()}
			label={t(kernelMessage("client.access.apps.title"))}
			loadingLabel={t(kernelMessage("client.access.apps.loading"))}
			loadFailedTitle={t(kernelMessage("client.access.apps.load-failed"))}
			loadMore={
				query.data?.pageInfo.hasMore === true
					? {
							onClick: query.fetchNextPage,
							isFetchingNextPage: query.isFetchingNextPage,
							label: t(kernelMessage("client.access.apps.load-more")),
						}
					: null
			}
			empty={
				<EmptyState
					icon={<AppIcon size={20} name="link" />}
					title={t(kernelMessage("client.access.apps.empty-title"))}
					className="rounded-xl border border-dashed border-border-emphasis"
					description={t(kernelMessage("client.access.apps.empty-description"))}
				/>
			}
			revoke={{
				reset: revoke.reset,
				run: revoke.mutateEffect,
				pending: revoke.isPending,
				failed: revoke.error !== null,
				detail: t(kernelMessage("client.access.apps.revoke-detail")),
				actionLabel: t(kernelMessage("client.access.apps.revoke-action")),
				errorMessage: t(kernelMessage("client.access.apps.revoke-failed")),
			}}
			rows={apps.map((app) => ({
				id: app.id,
				icon: "link",
				name: app.name,
				access: writeAccessLabel(t, app.writeAccess),
				detail: t(
					kernelMessage("client.access.apps.detail", {
						lastUsed: lastUsed(formatters, t, app.lastUsedAt, now),
						connected: kernelMessage("client.access.apps.connected", {
							date: new Date(app.createdAt),
						}),
					}),
				),
			}))}
		/>
	);
}

const keyName = (t: (message: Message) => Text, key: ApiKeyItem) =>
	key.name ?? t(kernelMessage("client.access.keys.unnamed"));

function ApiKeysList(props: { readonly onCreate: (trigger: HTMLButtonElement) => void }) {
	const t = useT();
	const formatters = useFormatters();
	const now = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const revoke = useRyotMutation(revokeApiKeyMutation);
	const query = useRyotInfiniteQuery(apiKeysQuery, undefined, {
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		getPageInput: (_, after: string | undefined) => after,
	});
	const keys = paginationItems(
		query.pages,
		(page) => page.items,
		(key) => key.id,
	);
	return (
		<CredentialList
			isError={query.isError}
			isPending={query.isPending}
			onRetry={() => query.refetch()}
			label={t(kernelMessage("client.access.keys.title"))}
			loadingLabel={t(kernelMessage("client.access.keys.loading"))}
			loadFailedTitle={t(kernelMessage("client.access.keys.load-failed"))}
			loadMore={
				query.data?.pageInfo.hasMore === true
					? {
							onClick: query.fetchNextPage,
							isFetchingNextPage: query.isFetchingNextPage,
							label: t(kernelMessage("client.access.keys.load-more")),
						}
					: null
			}
			revoke={{
				reset: revoke.reset,
				run: revoke.mutateEffect,
				pending: revoke.isPending,
				failed: revoke.error !== null,
				detail: t(kernelMessage("client.access.keys.revoke-detail")),
				actionLabel: t(kernelMessage("client.access.keys.revoke-action")),
				errorMessage: t(kernelMessage("client.access.keys.revoke-failed")),
			}}
			empty={
				<EmptyState
					icon={<AppIcon size={20} name="key-round" />}
					title={t(kernelMessage("client.access.keys.empty-title"))}
					className="rounded-xl border border-dashed border-border-emphasis"
					description={t(kernelMessage("client.access.keys.empty-description"))}
					action={
						<Button variant="secondary" onClick={(event) => props.onCreate(event.currentTarget)}>
							<AppIcon size={16} name="plus" />
							{t(kernelMessage("client.access.create.submit"))}
						</Button>
					}
				/>
			}
			rows={keys.map((key) => {
				const remainingMs = key.expiresAt === null ? null : Date.parse(key.expiresAt) - now;
				const expired = remainingMs !== null && remainingMs <= 0;
				const expiringSoon = remainingMs !== null && !expired && remainingMs <= EXPIRING_SOON_MS;
				let expiry = kernelMessage("client.access.keys.never-expires");
				if (key.expiresAt !== null) {
					expiry = kernelMessage(
						expired ? "client.access.keys.expired-on" : "client.access.keys.expires-on",
						{ date: new Date(key.expiresAt) },
					);
				}
				return {
					id: key.id,
					icon: "key-round",
					inactive: expired,
					name: keyName(t, key),
					access: writeAccessLabel(t, key.writeAccess),
					secondary: (
						<code className="truncate font-mono text-xs text-text-muted">
							{key.start ?? ""}
							<span aria-hidden="true">{KEY_MASK}</span>
						</code>
					),
					detail: t(
						kernelMessage("client.access.keys.detail", {
							expiry,
							lastUsed: lastUsed(formatters, t, key.lastUsedAt, now),
							created: kernelMessage("client.access.keys.created", {
								date: new Date(key.createdAt),
							}),
						}),
					),
					badges: (
						<>
							{expired ? (
								<Badge size="sm" variant="neutral">
									{t(kernelMessage("client.access.keys.expired-badge"))}
								</Badge>
							) : null}
							{expiringSoon ? (
								<Badge size="sm" variant="warning">
									{t(kernelMessage("client.access.keys.expires-soon-badge"))}
								</Badge>
							) : null}
						</>
					),
				};
			})}
		/>
	);
}
