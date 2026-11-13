import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, EmptyState } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ApiKeyItem } from "@ryot-app/ryotql-recipes/api-keys";
import { type ReactNode, useRef, useState } from "react";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { formatDateLabel, formatRelativeTime } from "#/modules/ui/run/run-status";
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

const lastUsed = (value: null | string, now: number) =>
	value === null ? "Never used" : `Last used ${formatRelativeTime(value, now)}`;

export function AccessManager(props: { readonly isDemo: boolean }) {
	const createTrigger = useRef<null | HTMLButtonElement>(null);
	const [creating, setCreating] = useState(false);
	const intro = (
		<p className="text-sm text-text-muted">
			Apps and scripts reach your account through connected apps and API keys. Each has its own
			access level and can be revoked here.
		</p>
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
				title="Connected apps"
				description="Apps you approved on Ryot's sign-in page, such as AI assistants connected over MCP."
			>
				<ConnectedAppsList />
			</AccessSection>
			<AccessSection
				title="API keys"
				description="Keys let scripts, automations and other apps work with your account without signing in. Keep them secret."
				action={
					<Button
						className="shrink-0 self-start sm:self-center"
						onClick={(event) => openCreate(event.currentTarget)}
					>
						<AppIcon size={16} name="plus" />
						Create key
					</Button>
				}
			>
				<ApiKeysList onCreate={openCreate} />
			</AccessSection>
			{creating ? (
				<CreateApiKeyDialog triggerRef={createTrigger} onClose={() => setCreating(false)} />
			) : null}
		</div>
	);
}

function AccessSection(props: {
	readonly title: string;
	readonly action?: ReactNode;
	readonly children: ReactNode;
	readonly description: string;
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
			label="connected apps"
			isError={query.isError}
			isPending={query.isPending}
			onRetry={() => query.refetch()}
			loadMore={
				query.data?.pageInfo.hasMore === true
					? {
							label: "Load more apps",
							onClick: query.fetchNextPage,
							isFetchingNextPage: query.isFetchingNextPage,
						}
					: null
			}
			rows={apps.map((app) => ({
				id: app.id,
				icon: "link",
				name: app.name,
				access: writeAccessLabel(app.writeAccess),
				detail: [`Connected ${formatDateLabel(app.createdAt)}`, lastUsed(app.lastUsedAt, now)].join(
					" · ",
				),
			}))}
			empty={
				<EmptyState
					title="No connected apps"
					icon={<AppIcon size={20} name="link" />}
					className="rounded-xl border border-dashed border-border-emphasis"
					description="Apps you connect through Ryot's sign-in page appear here."
				/>
			}
			revoke={{
				reset: revoke.reset,
				run: revoke.mutateEffect,
				pending: revoke.isPending,
				actionLabel: "Revoke access",
				failed: revoke.error !== null,
				errorMessage: "Access could not be revoked. Try again.",
				detail:
					"The app can no longer renew its access, and access it already holds ends within 15 minutes. Connect it again to restore access.",
			}}
		/>
	);
}

const keyName = (key: ApiKeyItem) => key.name ?? "Unnamed key";

function ApiKeysList(props: { readonly onCreate: (trigger: HTMLButtonElement) => void }) {
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
			label="API keys"
			isError={query.isError}
			isPending={query.isPending}
			onRetry={() => query.refetch()}
			loadMore={
				query.data?.pageInfo.hasMore === true
					? {
							label: "Load more keys",
							onClick: query.fetchNextPage,
							isFetchingNextPage: query.isFetchingNextPage,
						}
					: null
			}
			revoke={{
				reset: revoke.reset,
				run: revoke.mutateEffect,
				pending: revoke.isPending,
				actionLabel: "Revoke key",
				failed: revoke.error !== null,
				errorMessage: "The key could not be revoked. Try again.",
				detail: "Scripts and apps using this key stop working right away. This cannot be undone.",
			}}
			empty={
				<EmptyState
					title="No API keys yet"
					icon={<AppIcon size={20} name="key-round" />}
					className="rounded-xl border border-dashed border-border-emphasis"
					description="Create a key to connect a script, automation or another app to your account."
					action={
						<Button variant="secondary" onClick={(event) => props.onCreate(event.currentTarget)}>
							<AppIcon size={16} name="plus" />
							Create key
						</Button>
					}
				/>
			}
			rows={keys.map((key) => {
				const remainingMs = key.expiresAt === null ? null : Date.parse(key.expiresAt) - now;
				const expired = remainingMs !== null && remainingMs <= 0;
				const expiringSoon = remainingMs !== null && !expired && remainingMs <= EXPIRING_SOON_MS;
				let expiry = "Never expires";
				if (key.expiresAt !== null) {
					expiry = `${expired ? "Expired" : "Expires"} ${formatDateLabel(key.expiresAt)}`;
				}
				return {
					id: key.id,
					icon: "key-round",
					inactive: expired,
					name: keyName(key),
					access: writeAccessLabel(key.writeAccess),
					detail: [
						`Created ${formatDateLabel(key.createdAt)}`,
						lastUsed(key.lastUsedAt, now),
						expiry,
					].join(" · "),
					secondary: (
						<code className="truncate font-mono text-xs text-text-muted">
							{key.start ?? ""}
							<span aria-hidden="true">••••••••</span>
						</code>
					),
					badges: (
						<>
							{expired ? (
								<Badge size="sm" variant="neutral">
									Expired
								</Badge>
							) : null}
							{expiringSoon ? (
								<Badge size="sm" variant="warning">
									Expires soon
								</Badge>
							) : null}
						</>
					),
				};
			})}
		/>
	);
}
