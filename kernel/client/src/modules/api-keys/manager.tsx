import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	DestructiveConfirmation,
	EmptyState,
	LoadMoreButton,
	RowGroup,
	Skeleton,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ApiKeyItem } from "@ryot-app/ryotql-recipes/api-keys";
import clsx from "clsx";
import { Effect } from "effect";
import { useRef, useState } from "react";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { formatDateLabel, formatRelativeTime } from "#/modules/ui/run/run-status";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

import { CreateApiKeyDialog } from "./create-dialog";
import { apiKeysQuery, revokeApiKeyMutation } from "./service";

const EXPIRING_SOON_MS = 7 * 86_400_000;

const keyName = (key: ApiKeyItem) => key.name ?? "Unnamed key";

const keyDetail = (key: ApiKeyItem, now: number, expired: boolean) => {
	let expiry = "Never expires";
	if (key.expiresAt !== null) {
		expiry = `${expired ? "Expired" : "Expires"} ${formatDateLabel(key.expiresAt)}`;
	}
	return [
		`Created ${formatDateLabel(key.createdAt)}`,
		key.lastUsedAt === null ? "Never used" : `Last used ${formatRelativeTime(key.lastUsedAt, now)}`,
		expiry,
	].join(" · ");
};

export function ApiKeysManager(props: { readonly isDemo: boolean }) {
	const createTrigger = useRef<null | HTMLButtonElement>(null);
	const [creating, setCreating] = useState(false);

	if (props.isDemo) {
		return (
			<div className="flex flex-col gap-6">
				<ApiKeysIntro />
				<DemoProtectionMessage />
			</div>
		);
	}

	const openCreate = (trigger: HTMLButtonElement) => {
		createTrigger.current = trigger;
		setCreating(true);
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
				<ApiKeysIntro />
				<Button
					className="shrink-0 self-start sm:self-center"
					onClick={(event) => openCreate(event.currentTarget)}
				>
					<AppIcon size={16} name="plus" />
					Create key
				</Button>
			</div>
			<ApiKeysList onCreate={openCreate} />
			{creating ? (
				<CreateApiKeyDialog triggerRef={createTrigger} onClose={() => setCreating(false)} />
			) : null}
		</div>
	);
}

function ApiKeysIntro() {
	return (
		<p className="flex-1 text-sm text-text-muted">
			API keys let scripts, automations and other apps work with your account without signing in.
			Each key has full access to your data, so keep it secret.
		</p>
	);
}

function ApiKeyRow(props: {
	readonly now: number;
	readonly apiKey: ApiKeyItem;
	readonly onRevoke: (trigger: HTMLButtonElement) => void;
}) {
	const { now, apiKey } = props;
	const remainingMs = apiKey.expiresAt === null ? null : Date.parse(apiKey.expiresAt) - now;
	const expired = remainingMs !== null && remainingMs <= 0;
	const expiringSoon = remainingMs !== null && !expired && remainingMs <= EXPIRING_SOON_MS;

	return (
		<div role="listitem" className="flex items-center gap-3 px-4 py-3.5">
			<span
				aria-hidden="true"
				className={clsx(
					"flex size-10 shrink-0 items-center justify-center rounded-lg",
					expired ? "bg-surface-2 text-text-subtle" : "bg-accent-soft text-accent-text",
				)}
			>
				<AppIcon size={18} name="key-round" />
			</span>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<span className="truncate text-sm font-medium text-text">{keyName(apiKey)}</span>
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
				</div>
				<code className="truncate font-mono text-xs text-text-muted">
					{apiKey.start ?? ""}
					<span aria-hidden="true">••••••••</span>
				</code>
				<p className="text-xs text-text-muted">{keyDetail(apiKey, now, expired)}</p>
			</div>
			<Button
				size="sm"
				variant="dangerGhost"
				aria-label={`Revoke ${keyName(apiKey)}`}
				onClick={(event) => props.onRevoke(event.currentTarget)}
			>
				Revoke
			</Button>
		</div>
	);
}

function ApiKeysList(props: { readonly onCreate: (trigger: HTMLButtonElement) => void }) {
	const now = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const revoke = useRyotMutation(revokeApiKeyMutation);
	const revokeTrigger = useRef<null | HTMLButtonElement>(null);
	const [revoking, setRevoking] = useState<null | ApiKeyItem>(null);
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

	if (query.isPending) {
		return (
			<RowGroup aria-busy="true" aria-label="Loading API keys">
				{[0, 1].map((index) => (
					<div key={index} className="flex items-center gap-3 px-4 py-3.5">
						<Skeleton className="size-10 shrink-0 rounded-lg" />
						<div className="grid flex-1 gap-2">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-56" />
						</div>
					</div>
				))}
			</RowGroup>
		);
	}

	if (query.isError && keys.length === 0) {
		return (
			<LoadErrorState
				title="Could not load API keys"
				onRetry={() => query.refetch()}
				detail="Check your connection and try again."
			/>
		);
	}

	if (keys.length === 0) {
		return (
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
		);
	}

	return (
		<>
			<RowGroup role="list" aria-label="API keys">
				{keys.map((key) => (
					<ApiKeyRow
						now={now}
						key={key.id}
						apiKey={key}
						onRevoke={(trigger) => {
							revokeTrigger.current = trigger;
							setRevoking(key);
						}}
					/>
				))}
			</RowGroup>
			{query.data?.pageInfo.hasMore === true ? (
				<LoadMoreButton
					label="Load more keys"
					onClick={query.fetchNextPage}
					disabled={query.isFetchingNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			) : null}
			{revoking === null ? null : (
				<DestructiveConfirmation
					actionLabel="Revoke key"
					pendingLabel="Revoking..."
					triggerRef={revokeTrigger}
					pending={revoke.isPending}
					title={`Revoke "${keyName(revoking)}"?`}
					onClose={() => {
						revoke.reset();
						setRevoking(null);
					}}
					detail="Scripts and apps using this key stop working right away. This cannot be undone."
					errorMessage={
						revoke.error !== null ? "The key could not be revoked. Try again." : undefined
					}
					onConfirm={() =>
						void Effect.runPromise(
							revoke
								.mutateEffect(revoking.id)
								.pipe(
									Effect.match({ onFailure: () => undefined, onSuccess: () => setRevoking(null) }),
								),
						)
					}
				/>
			)}
		</>
	);
}
