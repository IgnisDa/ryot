import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { nextPageCursor, paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	CopyField,
	DestructiveConfirmation,
	LoadMoreButton,
	Menu,
	type MenuItem,
	useFieldEscape,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import clsx from "clsx";
import { Cause, Effect } from "effect";
import { type RefObject, type SyntheticEvent, useEffect, useRef, useState } from "react";

import type { ShareAction } from "#/modules/device/share";
import {
	isUnauthorizedCause,
	runAdminAction,
	withAdminAuthorization,
} from "#/modules/instance-admin/errors";
import type {
	InstanceAdminPasswordResetResult,
	InstanceAdminSetDisabledResult,
	InstanceAdminUser,
	InstanceAdminUsers,
} from "#/modules/instance-admin/service";
import type {
	InstanceAdminUserLifecycleOperation,
	InstanceAdminUserResetResult,
} from "#/modules/instance-admin/user-lifecycle";
import { useUnmountSignal } from "#/modules/ui/use-unmount-signal";

const PAGE_SIZE = 50;

export type InstanceAdminUserOperations = {
	readonly impersonateUser: (userId: string) => Effect.Effect<string, unknown>;
	readonly resetUser: (userId: string) => Effect.Effect<InstanceAdminUserResetResult, unknown>;
	readonly deleteUser: (
		userId: string,
	) => Effect.Effect<InstanceAdminUserLifecycleOperation, unknown>;
	readonly resetUserPassword: (
		userId: string,
	) => Effect.Effect<InstanceAdminPasswordResetResult, unknown>;
	readonly setUserDisabled: (
		userId: string,
		disabled: boolean,
	) => Effect.Effect<InstanceAdminSetDisabledResult, unknown>;
	readonly listUsers: (
		search: string,
		after: string | undefined,
		limit: number,
	) => Effect.Effect<InstanceAdminUsers, unknown>;
};

type UserAction = "reset" | "delete" | "password" | "disabled" | "impersonate";

type UsersAdministrationProps = {
	readonly shareAction: ShareAction;
	readonly onUnauthorized: () => void;
	readonly operations: InstanceAdminUserOperations;
};

function UserPageStatus(props: {
	readonly onRetry: () => void;
	readonly state: "error" | "loading";
}) {
	const t = useT();
	if (props.state === "loading") {
		return <p role="status">{t(kernelMessage("client.instance-admin.users.loading"))}</p>;
	}
	return (
		<div className="grid justify-items-center gap-3">
			<p role="alert" className="text-danger">
				{t(kernelMessage("client.instance-admin.users.load-failed"))}
			</p>
			<Button type="button" variant="secondary" onClick={props.onRetry}>
				{t(kernelMessage("common.action.retry"))}
			</Button>
		</div>
	);
}

const formatDate = (formatters: Formatters, value: string) =>
	formatters.dateTime({ dateStyle: "medium" }).format(new Date(value));

const userColumns = (
	t: (message: Message) => Text,
): ReadonlyArray<DataTableColumn<InstanceAdminUser>> => [
	{
		id: "email",
		headerClassName: "px-2 py-3 font-semibold",
		header: t(kernelMessage("client.instance-admin.users.column.email")),
	},
	{
		id: "name",
		headerClassName: "hidden px-2 py-3 font-semibold md:table-cell",
		header: t(kernelMessage("client.instance-admin.users.column.name")),
	},
	{
		id: "auth",
		headerClassName: "hidden px-2 py-3 font-semibold md:table-cell",
		header: t(kernelMessage("client.instance-admin.users.column.auth")),
	},
	{
		id: "status",
		headerClassName: "px-2 py-3 font-semibold",
		header: t(kernelMessage("client.instance-admin.users.column.status")),
	},
	{
		id: "created",
		headerClassName: "hidden px-2 py-3 font-semibold lg:table-cell",
		header: t(kernelMessage("client.instance-admin.users.column.created")),
	},
	{
		id: "actions",
		headerClassName: "px-2 py-3 font-semibold",
		header: t(kernelMessage("sdk.browser.actions")),
	},
];

const logFailure = (label: string, cause: Cause.Cause<unknown>) =>
	Effect.runSync(Effect.logWarning(label, Cause.pretty(cause)));

export function UsersAdministration(props: UsersAdministrationProps) {
	const t = useT();
	const [search, setSearch] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	useFieldEscape(searchInput, { hasValue: search !== "", onClear: () => setSearch("") });
	const [query, setQuery] = useState("");
	const pagination = usePagination<InstanceAdminUsers, string | undefined>({
		identity: query,
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		load: (after) =>
			withAdminAuthorization(
				props.operations.listUsers(query, after, PAGE_SIZE),
				props.onUnauthorized,
			).pipe(
				Effect.tapCause((cause) =>
					isUnauthorizedCause(cause)
						? Effect.void
						: Effect.logWarning("instance-admin users request failed", cause),
				),
			),
	});

	useEffect(() => {
		const timer = setTimeout(() => setQuery(search.trim()), 300);
		return () => clearTimeout(timer);
	}, [search]);

	const users = paginationItems(
		pagination.pages,
		(page) => page.items,
		(user) => user.id,
	);
	const loaded = users.length;
	const total = pagination.pages.at(0)?.total ?? 0;
	const refreshUsers = pagination.refetch;
	const submitSearch = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		setQuery(search.trim());
	};
	const unauthorized = pagination.cause !== null && isUnauthorizedCause(pagination.cause);
	if (unauthorized) {
		return null;
	}
	let pageState: "error" | "loading" | undefined;
	if (pagination.errorOperation !== null) {
		pageState = "error";
	} else if (pagination.isFetching || pagination.isPending) {
		pageState = "loading";
	}
	const bodyEndRows =
		pageState === undefined
			? []
			: [
					{
						id: "pagination-status",
						cellClassName: "px-2 py-10 text-center text-text-muted",
						content: <UserPageStatus state={pageState} onRetry={pagination.retry} />,
					},
				];

	return (
		<section className="ui-card max-w-6xl" aria-labelledby="instance-admin-users-title">
			<p className="ui-overline">{t(kernelMessage("client.settings.section.administration"))}</p>
			<h1 id="instance-admin-users-title" className="font-display text-3xl font-semibold">
				{t(kernelMessage("client.instance-admin.users.title"))}
			</h1>
			<p className="ui-subtitle">{t(kernelMessage("client.instance-admin.users.subtitle"))}</p>
			<form role="search" onSubmit={submitSearch} className="mt-6 flex max-w-md gap-2">
				<label className="sr-only" htmlFor="instance-admin-user-search">
					{t(kernelMessage("client.instance-admin.users.search-label"))}
				</label>
				<input
					type="search"
					value={search}
					ref={searchInput}
					className="ui-field-input"
					id="instance-admin-user-search"
					onChange={(event) => setSearch(event.currentTarget.value)}
					placeholder={t(kernelMessage("client.instance-admin.users.search-placeholder"))}
				/>
				<Button type="submit" variant="secondary">
					{t(kernelMessage("common.action.search"))}
				</Button>
			</form>
			<div className="mt-5 overflow-x-auto">
				<DataTable
					data={users}
					columns={userColumns(t)}
					bodyEndRows={bodyEndRows}
					getRowId={(user) => user.id}
					className="w-full border-collapse text-left text-sm"
					headerClassName="border-b border-border text-xs text-text-muted"
					renderRow={(user) => (
						<UserRow
							user={user}
							onRefresh={refreshUsers}
							operations={props.operations}
							shareAction={props.shareAction}
							onUnauthorized={props.onUnauthorized}
						/>
					)}
				/>
			</div>
			{pagination.pages.length > 0 && loaded === 0 && !pagination.isFetching && (
				<div className="py-12 text-center">
					<h2 className="font-display text-lg font-semibold">
						{t(kernelMessage("client.instance-admin.users.empty-title"))}
					</h2>
					<p className="mt-1 text-sm text-text-muted">
						{query === ""
							? t(kernelMessage("client.instance-admin.users.empty-all"))
							: t(kernelMessage("client.instance-admin.users.empty-search", { query }))}
					</p>
				</div>
			)}
			{pagination.pages.length > 0 && loaded > 0 && (
				<p className="mt-4 text-center text-sm text-text-muted">
					{t(kernelMessage("client.instance-admin.users.showing", { total, loaded }))}
				</p>
			)}
			{pagination.hasNextPage && pagination.errorOperation !== "append" && (
				<div className="mt-5 flex justify-center">
					<LoadMoreButton
						type="button"
						onClick={pagination.fetchNextPage}
						isFetchingNextPage={pagination.isFetchingNextPage}
						label={t(kernelMessage("client.instance-admin.users.load-more"))}
						disabled={pagination.isFetching && !pagination.isFetchingNextPage}
						loadingLabel={t(kernelMessage("client.instance-admin.users.loading-more"))}
					/>
				</div>
			)}
		</section>
	);
}

function Badge(props: { readonly children: string; readonly tone?: "danger" | "success" }) {
	return (
		<span
			className={clsx(
				"inline-flex rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold",
				props.tone === "success" && "bg-success-soft text-success",
				props.tone === "danger" && "text-danger",
			)}
		>
			{props.children}
		</span>
	);
}

function UserRow(props: {
	readonly onRefresh: () => void;
	readonly user: InstanceAdminUser;
	readonly shareAction: ShareAction;
	readonly onUnauthorized: () => void;
	readonly operations: InstanceAdminUserOperations;
}) {
	const t = useT();
	const formatters = useFormatters();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const pendingRef = useRef<null | string>(null);
	const unmountSignal = useUnmountSignal();
	const [error, setError] = useState<Message>();
	const [confirmation, setConfirmation] = useState<null | "reset" | "delete">(null);
	const [pending, setPending] = useState<
		null | "reset" | "delete" | "password" | "disabled" | "impersonation"
	>(null);
	const [result, setResult] = useState<
		null | InstanceAdminUserResetResult | InstanceAdminPasswordResetResult
	>(null);
	const [impersonationUrl, setImpersonationUrl] = useState<null | string>(null);
	const linkUrl = impersonationUrl ?? result?.resetUrl;
	const linkLabel = t(
		impersonationUrl === null
			? kernelMessage("client.instance-admin.users.reset-link")
			: kernelMessage("client.instance-admin.users.impersonation-link"),
	);
	const isDisabled = props.user.disabledAt !== null;
	const canResetPassword = props.user.authState === "credential" || props.user.authState === "none";
	let resetNote: Text | undefined;
	if (props.user.authState === "oidc") {
		resetNote = t(kernelMessage("client.instance-admin.users.reset-note.oidc"));
	} else if (props.user.authState === "mixed") {
		resetNote = t(kernelMessage("client.instance-admin.users.reset-note.mixed"));
	}
	let disabledActionLabel = t(
		isDisabled
			? kernelMessage("client.instance-admin.users.action.enable")
			: kernelMessage("client.instance-admin.users.action.disable"),
	);
	if (pending === "disabled") {
		disabledActionLabel = t(
			isDisabled
				? kernelMessage("client.instance-admin.users.action.enabling")
				: kernelMessage("client.instance-admin.users.action.disabling"),
		);
	}

	const run = <A,>(
		kind: NonNullable<typeof pending>,
		operation: () => Effect.Effect<A, unknown>,
		onSuccess: (value: A) => void,
		failureMessage: Message,
	) =>
		Effect.suspend(() => {
			const signal = unmountSignal();
			if (pendingRef.current !== null || signal.aborted) {
				return Effect.void;
			}
			pendingRef.current = kind;
			setPending(kind);
			setError(undefined);
			return runAdminAction({
				signal,
				operation,
				onSuccess,
				onUnauthorized: props.onUnauthorized,
				onSettled: (aborted) => {
					pendingRef.current = null;
					if (!aborted) {
						setPending(null);
					}
				},
				onFailure: (cause) => {
					logFailure(`instance-admin user ${kind} request failed`, cause);
					setError(failureMessage);
				},
			});
		});
	const resetPassword = () =>
		run(
			"password",
			() => {
				setResult(null);
				setImpersonationUrl(null);
				return props.operations.resetUserPassword(props.user.id);
			},
			setResult,
			kernelMessage("client.instance-admin.users.error.reset-link"),
		);
	const toggleDisabled = () =>
		run(
			"disabled",
			() => props.operations.setUserDisabled(props.user.id, !isDisabled),
			props.onRefresh,
			isDisabled
				? kernelMessage("client.instance-admin.users.error.enable")
				: kernelMessage("client.instance-admin.users.error.disable"),
		);
	const impersonate = () =>
		run(
			"impersonation",
			() => {
				setResult(null);
				setImpersonationUrl(null);
				return props.operations.impersonateUser(props.user.id);
			},
			setImpersonationUrl,
			kernelMessage("client.instance-admin.users.error.impersonate"),
		);
	const confirm = () => {
		const kind = confirmation;
		if (kind === null) {
			return Effect.void;
		}
		if (kind === "reset") {
			return run(
				"reset",
				() => {
					setResult(null);
					setImpersonationUrl(null);
					return props.operations.resetUser(props.user.id);
				},
				(value) => {
					setConfirmation(null);
					setResult(value);
				},
				kernelMessage("client.instance-admin.users.error.reset"),
			);
		}
		return run(
			"delete",
			() => {
				setResult(null);
				setImpersonationUrl(null);
				return props.operations.deleteUser(props.user.id);
			},
			() => {
				setConfirmation(null);
				props.onRefresh();
			},
			kernelMessage("client.instance-admin.users.error.delete"),
		);
	};
	const selectAction = (kind: UserAction) => {
		setError(undefined);
		if (kind === "reset" || kind === "delete") {
			setConfirmation(kind);
			return;
		}
		if (kind === "password") {
			queueMicrotask(() => Effect.runFork(resetPassword(), { signal: unmountSignal() }));
			return;
		}
		if (kind === "disabled") {
			queueMicrotask(() => Effect.runFork(toggleDisabled(), { signal: unmountSignal() }));
			return;
		}
		queueMicrotask(() => Effect.runFork(impersonate(), { signal: unmountSignal() }));
	};
	const actionItems: ReadonlyArray<MenuItem> = [
		{
			key: "password",
			destructive: false,
			onSelect: () => selectAction("password"),
			disabled: !canResetPassword || pending !== null,
			label: t(
				pending === "password"
					? kernelMessage("client.instance-admin.users.action.generating")
					: kernelMessage("client.instance-admin.users.action.generate-link"),
			),
		},
		{
			key: "disabled",
			destructive: !isDisabled,
			disabled: pending !== null,
			label: disabledActionLabel,
			onSelect: () => selectAction("disabled"),
		},
		{
			key: "impersonate",
			destructive: false,
			disabled: pending !== null,
			onSelect: () => selectAction("impersonate"),
			label: t(
				pending === "impersonation"
					? kernelMessage("common.status.starting")
					: kernelMessage("client.instance-admin.users.action.impersonate"),
			),
		},
		{
			key: "reset",
			destructive: true,
			disabled: pending !== null,
			onSelect: () => selectAction("reset"),
			label: t(
				pending === "reset"
					? kernelMessage("client.instance-admin.users.action.resetting")
					: kernelMessage("client.instance-admin.users.action.reset"),
			),
		},
		{
			key: "delete",
			destructive: true,
			disabled: pending !== null,
			onSelect: () => selectAction("delete"),
			label: t(
				pending === "delete"
					? kernelMessage("common.status.deleting")
					: kernelMessage("client.instance-admin.users.action.delete"),
			),
		},
	];

	return (
		<>
			<tr className="border-b border-border align-top">
				<td className="min-w-48 px-2 py-4">
					<p className={clsx("font-semibold", isDisabled && "text-text-muted line-through")}>
						{props.user.email}
					</p>
					<p className="mt-0.5 text-xs text-text-muted md:hidden">
						{props.user.name} · {t(authLabel(props.user.authState))}
					</p>
					{props.user.disabledAt && (
						<p className="mt-1 text-xs text-text-subtle">
							{t(
								kernelMessage("client.instance-admin.users.disabled-since", {
									date: new Date(props.user.disabledAt),
								}),
							)}
						</p>
					)}
				</td>
				<td className="hidden px-2 py-4 text-text-muted md:table-cell">{props.user.name}</td>
				<td className="hidden px-2 py-4 md:table-cell">
					<Badge>{t(authLabel(props.user.authState))}</Badge>
				</td>
				<td className="px-2 py-4">
					<Badge tone={isDisabled ? "danger" : "success"}>
						{t(
							isDisabled
								? kernelMessage("client.instance-admin.users.status.disabled")
								: kernelMessage("client.instance-admin.users.status.enabled"),
						)}
					</Badge>
				</td>
				<td className="hidden px-2 py-4 whitespace-nowrap text-text-muted lg:table-cell">
					{formatDate(formatters, props.user.createdAt)}
				</td>
				<td className="w-14 px-2 py-3">
					<Menu
						note={resetNote}
						items={actionItems}
						label={t(kernelMessage("client.instance-admin.users.actions-menu"))}
						trigger={
							<button
								type="button"
								ref={triggerRef}
								disabled={pending !== null}
								aria-label={t(
									kernelMessage("client.instance-admin.users.row-actions", {
										email: props.user.email,
									}),
								)}
								className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-border-strong bg-raised text-text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-text-subtle"
							>
								<AppIcon size={18} name="more-horizontal" />
							</button>
						}
					/>
				</td>
			</tr>
			{(error !== undefined || result !== null || impersonationUrl !== null) && (
				<tr className="border-b border-border">
					<td colSpan={6} className="px-2 py-3">
						{error && (
							<p role="alert" className="text-sm text-danger">
								{t(error)}
							</p>
						)}
						{result?.resetUrl === null && (
							<p role="status" className="text-sm text-success">
								{t(kernelMessage("client.instance-admin.users.reset-completed"))}
							</p>
						)}
						{linkUrl && (
							<CopyField
								href={linkUrl}
								value={linkUrl}
								label={linkLabel}
								className="max-w-2xl"
								action={props.shareAction({ url: linkUrl })}
								hint={t(
									kernelMessage("client.instance-admin.users.link-hint", {
										email: result?.email ?? props.user.email,
									}),
								)}
							/>
						)}
					</td>
				</tr>
			)}
			{confirmation && (
				<ConfirmationDialog
					error={error}
					kind={confirmation}
					triggerRef={triggerRef}
					pending={pending === confirmation}
					onConfirm={() => Effect.runFork(confirm(), { signal: unmountSignal() })}
					onClose={() => {
						if (pendingRef.current === null) {
							setError(undefined);
							setConfirmation(null);
						}
					}}
				/>
			)}
		</>
	);
}

const authLabel = (state: InstanceAdminUser["authState"]) =>
	kernelMessage("client.instance-admin.users.auth", { state });

function ConfirmationDialog(props: {
	readonly error?: Message;
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly kind: "reset" | "delete";
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const t = useT();
	const reset = props.kind === "reset";
	return (
		<DestructiveConfirmation
			pending={props.pending}
			onClose={props.onClose}
			onConfirm={props.onConfirm}
			triggerRef={props.triggerRef}
			errorMessage={props.error === undefined ? undefined : t(props.error)}
			pendingLabel={t(
				reset
					? kernelMessage("client.instance-admin.users.action.resetting")
					: kernelMessage("common.status.deleting"),
			)}
			actionLabel={t(
				reset
					? kernelMessage("client.instance-admin.users.action.reset")
					: kernelMessage("client.instance-admin.users.action.delete"),
			)}
			detail={t(
				reset
					? kernelMessage("client.instance-admin.users.confirm.reset-body")
					: kernelMessage("client.instance-admin.users.confirm.delete-body"),
			)}
			title={t(
				reset
					? kernelMessage("client.instance-admin.users.confirm.reset-title")
					: kernelMessage("client.instance-admin.users.confirm.delete-title"),
			)}
		/>
	);
}
