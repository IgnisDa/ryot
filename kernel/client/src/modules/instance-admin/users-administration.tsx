import { nextPageCursor, paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	LoadMoreButton,
	Menu,
	type MenuItem,
	Modal,
	useFieldEscape,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/plugin-ui-sdk/table";
import clsx from "clsx";
import { Cause, Effect, Exit } from "effect";
import {
	type RefObject,
	type SyntheticEvent,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState,
} from "react";

import { isUnauthorizedCause, readAdminResult } from "#/modules/instance-admin/errors";
import type { ResetLinkTransfer } from "#/modules/instance-admin/reset-link-transfer";
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
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";

const PAGE_SIZE = 50;

type OperationResult<A> = Effect.Effect<Exit.Exit<A, unknown>>;

type UserAction = "password" | "disabled" | "reset" | "delete" | "impersonate";

function UserPageStatus(props: {
	readonly state: "loading" | "error";
	readonly onRetry: () => void;
}) {
	if (props.state === "loading") {
		return <p role="status">Loading users...</p>;
	}
	return (
		<div className="grid justify-items-center gap-3">
			<p role="alert" className="text-danger">
				Could not load users. Check the server and try again.
			</p>
			<Button type="button" variant="secondary" onClick={props.onRetry}>
				Retry
			</Button>
		</div>
	);
}

export type InstanceAdminUserOperations = {
	readonly resetUser: (userId: string) => OperationResult<InstanceAdminUserResetResult>;
	readonly deleteUser: (userId: string) => OperationResult<InstanceAdminUserLifecycleOperation>;
	readonly resetUserPassword: (userId: string) => OperationResult<InstanceAdminPasswordResetResult>;
	readonly setUserDisabled: (
		userId: string,
		disabled: boolean,
	) => OperationResult<InstanceAdminSetDisabledResult>;
	readonly listUsers: (
		search: string,
		after: string | undefined,
		limit: number,
	) => OperationResult<InstanceAdminUsers>;
	readonly impersonateUser: (userId: string) => OperationResult<void>;
};

type UsersAdministrationProps = {
	readonly onUnauthorized: () => void;
	readonly operations: InstanceAdminUserOperations;
	readonly backInterceptors: BackInterceptors;
	readonly transferResetLink: ResetLinkTransfer;
};

const formatDate = (value: string) =>
	new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

const userColumns: ReadonlyArray<DataTableColumn<InstanceAdminUser>> = [
	{ id: "email", header: "Email", headerClassName: "px-2 py-3 font-semibold" },
	{ id: "name", header: "Name", headerClassName: "hidden px-2 py-3 font-semibold md:table-cell" },
	{ id: "auth", header: "Auth", headerClassName: "hidden px-2 py-3 font-semibold md:table-cell" },
	{ id: "status", header: "Status", headerClassName: "px-2 py-3 font-semibold" },
	{
		id: "created",
		header: "Created",
		headerClassName: "hidden px-2 py-3 font-semibold lg:table-cell",
	},
	{ id: "actions", header: "Actions", headerClassName: "px-2 py-3 font-semibold" },
];

const logFailure = (label: string, cause: Cause.Cause<unknown>) =>
	Effect.runSync(Effect.logWarning(label, Cause.pretty(cause)));

export function UsersAdministration(props: UsersAdministrationProps) {
	const [search, setSearch] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	useFieldEscape(searchInput, { hasValue: search !== "", onClear: () => setSearch("") });
	const [query, setQuery] = useState("");
	const pagination = usePagination<InstanceAdminUsers, string | undefined>({
		identity: query,
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		load: (after) =>
			readAdminResult(
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
			<p className="ui-overline">Administration</p>
			<h1 id="instance-admin-users-title" className="font-display text-3xl font-semibold">
				Users
			</h1>
			<p className="ui-subtitle">Manage account access, recovery, and user data.</p>
			<form role="search" onSubmit={submitSearch} className="mt-6 flex max-w-md gap-2">
				<label className="sr-only" htmlFor="instance-admin-user-search">
					Search users by email
				</label>
				<input
					type="search"
					value={search}
					ref={searchInput}
					className="ui-field-input"
					placeholder="Search by email"
					id="instance-admin-user-search"
					onChange={(event) => setSearch(event.currentTarget.value)}
				/>
				<Button type="submit" variant="secondary">
					Search
				</Button>
			</form>
			<div className="mt-5 overflow-x-auto">
				<DataTable
					data={users}
					columns={userColumns}
					bodyEndRows={bodyEndRows}
					getRowId={(user) => user.id}
					className="w-full border-collapse text-left text-sm"
					headerClassName="border-b border-border text-xs text-text-muted"
					renderRow={(user) => (
						<UserRow
							user={user}
							onRefresh={refreshUsers}
							operations={props.operations}
							onUnauthorized={props.onUnauthorized}
							backInterceptors={props.backInterceptors}
							transferResetLink={props.transferResetLink}
						/>
					)}
				/>
			</div>
			{pagination.pages.length > 0 && loaded === 0 && !pagination.isFetching && (
				<div className="py-12 text-center">
					<h2 className="font-display text-lg font-semibold">No users found</h2>
					<p className="mt-1 text-sm text-text-muted">
						{query === ""
							? "This server has no user accounts yet."
							: `No user email matches “${query}”.`}
					</p>
				</div>
			)}
			{pagination.pages.length > 0 && loaded > 0 && (
				<p className="mt-4 text-center text-sm text-text-muted">
					Showing {loaded.toLocaleString()} of {total.toLocaleString()} users
				</p>
			)}
			{pagination.hasNextPage && pagination.errorOperation !== "append" && (
				<div className="mt-5 flex justify-center">
					<LoadMoreButton
						type="button"
						label="Load more users"
						onClick={pagination.fetchNextPage}
						loadingLabel="Loading more users..."
						isFetchingNextPage={pagination.isFetchingNextPage}
						disabled={pagination.isFetching && !pagination.isFetchingNextPage}
					/>
				</div>
			)}
		</section>
	);
}

function UserRow(props: {
	readonly user: InstanceAdminUser;
	readonly onRefresh: () => void;
	readonly onUnauthorized: () => void;
	readonly operations: InstanceAdminUserOperations;
	readonly backInterceptors: BackInterceptors;
	readonly transferResetLink: ResetLinkTransfer;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const pendingRef = useRef<string | null>(null);
	const menuId = useId();
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string>();
	const [confirmation, setConfirmation] = useState<"reset" | "delete" | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeMenuIndex, setActiveMenuIndex] = useState(0);
	const [pending, setPending] = useState<
		"password" | "disabled" | "reset" | "delete" | "impersonation" | null
	>(null);
	const [result, setResult] = useState<
		InstanceAdminPasswordResetResult | InstanceAdminUserResetResult | null
	>(null);
	const isDisabled = props.user.disabledAt !== null;
	const canResetPassword = props.user.authState === "credential" || props.user.authState === "none";
	let resetNote: string | undefined;
	if (props.user.authState === "oidc") {
		resetNote = "OIDC-only user: password reset links are unavailable.";
	} else if (props.user.authState === "mixed") {
		resetNote = "Mixed authentication: manual recovery is required.";
	}
	let disabledActionLabel = isDisabled ? "Enable user" : "Disable user";
	if (pending === "disabled") {
		disabledActionLabel = isDisabled ? "Enabling..." : "Disabling...";
	}

	useEffect(
		() => () => {
			if (copyTimer.current !== undefined) {
				clearTimeout(copyTimer.current);
			}
		},
		[],
	);

	const run = <A,>(kind: NonNullable<typeof pending>, operation: () => OperationResult<A>) => {
		if (pendingRef.current !== null) {
			return Effect.succeed(null);
		}
		pendingRef.current = kind;
		setPending(kind);
		setError(undefined);
		return operation().pipe(
			Effect.map((exit) => {
				pendingRef.current = null;
				setPending(null);
				if (Exit.isSuccess(exit)) {
					return exit.value;
				}
				if (isUnauthorizedCause(exit.cause)) {
					props.onUnauthorized();
				} else {
					logFailure(`instance-admin user ${kind} request failed`, exit.cause);
				}
				return null;
			}),
		);
	};
	const resetPassword = () => {
		setCopied(false);
		setResult(null);
		return run("password", () => props.operations.resetUserPassword(props.user.id)).pipe(
			Effect.map((value) => {
				if (value !== null) {
					setResult(value);
				} else if (pendingRef.current === null) {
					setError("Could not generate a reset link. Try again.");
				}
			}),
		);
	};
	const toggleDisabled = () =>
		run("disabled", () => props.operations.setUserDisabled(props.user.id, !isDisabled)).pipe(
			Effect.map((value) => {
				if (value !== null) {
					props.onRefresh();
				} else if (pendingRef.current === null) {
					setError(`Could not ${isDisabled ? "enable" : "disable"} this user. Try again.`);
				}
			}),
		);
	const impersonate = () =>
		run("impersonation", () => props.operations.impersonateUser(props.user.id)).pipe(
			Effect.map((value) => {
				if (value === null && pendingRef.current === null) {
					setError("Could not start impersonation. Try again.");
				}
			}),
		);
	const confirm = () => {
		setResult(null);
		const kind = confirmation;
		if (kind === null) {
			return Effect.void;
		}
		if (kind === "reset") {
			return run("reset", () => props.operations.resetUser(props.user.id)).pipe(
				Effect.map((value) => {
					if (value === null) {
						if (pendingRef.current === null) {
							setError("Could not reset this user. Try again.");
						}
						return;
					}
					setConfirmation(null);
					setResult(value);
				}),
			);
		}
		return run("delete", () => props.operations.deleteUser(props.user.id)).pipe(
			Effect.map((value) => {
				if (value === null) {
					if (pendingRef.current === null) {
						setError("Could not delete this user. Try again.");
					}
					return;
				}
				setConfirmation(null);
				props.onRefresh();
			}),
		);
	};
	const transfer = () => {
		if (result?.resetUrl == null) {
			return Effect.void;
		}
		return props.transferResetLink(result.resetUrl).pipe(
			Effect.tapError((failure) =>
				Effect.logWarning("instance-admin reset link transfer failed", failure.cause),
			),
			Effect.match({
				onFailure: () => setError("Could not copy or share the reset link. Try again."),
				onSuccess: () => {
					setCopied(true);
					copyTimer.current = setTimeout(() => setCopied(false), 2000);
				},
			}),
		);
	};
	const closeMenu = (restoreFocus: boolean) => {
		setMenuOpen(false);
		if (restoreFocus) {
			queueMicrotask(() => triggerRef.current?.focus());
		}
	};
	const selectAction = (kind: UserAction) => {
		closeMenu(kind !== "reset" && kind !== "delete");
		setError(undefined);
		if (kind === "reset" || kind === "delete") {
			setConfirmation(kind);
			return;
		}
		if (kind === "password") {
			queueMicrotask(() => Effect.runFork(resetPassword()));
			return;
		}
		if (kind === "disabled") {
			queueMicrotask(() => Effect.runFork(toggleDisabled()));
			return;
		}
		queueMicrotask(() => Effect.runFork(impersonate()));
	};
	const actionItems: ReadonlyArray<MenuItem> = [
		{
			key: "password",
			destructive: false,
			onSelect: () => selectAction("password"),
			disabled: !canResetPassword || pending !== null,
			label: pending === "password" ? "Generating..." : "Generate reset link",
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
			label: pending === "impersonation" ? "Starting..." : "Impersonate user",
		},
		{
			key: "reset",
			destructive: true,
			disabled: pending !== null,
			onSelect: () => selectAction("reset"),
			label: pending === "reset" ? "Resetting..." : "Reset account",
		},
		{
			key: "delete",
			destructive: true,
			disabled: pending !== null,
			onSelect: () => selectAction("delete"),
			label: pending === "delete" ? "Deleting..." : "Delete user",
		},
	];
	const openMenu = () => {
		const firstEnabled = actionItems.findIndex((item) => !item.disabled);
		setActiveMenuIndex(firstEnabled === -1 ? 0 : firstEnabled);
		setMenuOpen(true);
	};

	return (
		<>
			<tr className="border-b border-border align-top">
				<td className="min-w-48 px-2 py-4">
					<p className={clsx("font-semibold", isDisabled && "text-text-muted line-through")}>
						{props.user.email}
					</p>
					<p className="mt-0.5 text-xs text-text-muted md:hidden">
						{props.user.name} · {authLabel(props.user.authState)}
					</p>
					{props.user.disabledAt && (
						<p className="mt-1 text-xs text-text-subtle">
							Disabled since {formatDate(props.user.disabledAt)}
						</p>
					)}
				</td>
				<td className="hidden px-2 py-4 text-text-muted md:table-cell">{props.user.name}</td>
				<td className="hidden px-2 py-4 md:table-cell">
					<Badge>{authLabel(props.user.authState)}</Badge>
				</td>
				<td className="px-2 py-4">
					<Badge tone={isDisabled ? "danger" : "success"}>
						{isDisabled ? "Disabled" : "Enabled"}
					</Badge>
				</td>
				<td className="hidden px-2 py-4 whitespace-nowrap text-text-muted lg:table-cell">
					{formatDate(props.user.createdAt)}
				</td>
				<td className="w-14 px-2 py-3">
					<button
						type="button"
						ref={triggerRef}
						aria-haspopup="menu"
						aria-controls={menuId}
						aria-expanded={menuOpen}
						disabled={pending !== null}
						aria-label={`Actions for ${props.user.email}`}
						onClick={() => (menuOpen ? closeMenu(true) : openMenu())}
						className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-border-strong bg-raised text-text-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-text-subtle"
					>
						<AppIcon size={18} name="more-horizontal" />
					</button>
					<UserActionsMenu
						id={menuId}
						open={menuOpen}
						note={resetNote}
						items={actionItems}
						onClose={closeMenu}
						triggerRef={triggerRef}
						activeIndex={activeMenuIndex}
						onActiveIndexChange={setActiveMenuIndex}
						backInterceptors={props.backInterceptors}
					/>
				</td>
			</tr>
			{(error !== undefined || result !== null) && (
				<tr className="border-b border-border">
					<td colSpan={6} className="px-2 py-3">
						{error && (
							<p role="alert" className="text-sm text-danger">
								{error}
							</p>
						)}
						{result?.resetUrl === null && (
							<p role="status" className="text-sm text-success">
								Account reset completed. This user signs in through OIDC, so no password reset link
								was created.
							</p>
						)}
						{result?.resetUrl && (
							<div className="grid gap-2 rounded-lg border border-border bg-raised p-3">
								<p className="text-xs text-text-muted">Reset link for {result.email}</p>
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<input
										readOnly
										value={result.resetUrl}
										aria-label="Password reset link"
										className="min-w-0 flex-1 basis-40 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal text-text md:text-[13px]"
									/>
									<button
										type="button"
										disabled={copied}
										onClick={() => Effect.runFork(transfer())}
										className="min-h-9 shrink-0 rounded-lg border border-border-strong px-3 py-2 text-[13px] font-semibold text-text disabled:opacity-50"
									>
										{copied ? "Copied!" : "Copy or share"}
									</button>
								</div>
							</div>
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
					backInterceptors={props.backInterceptors}
					onConfirm={() => Effect.runFork(confirm())}
					onClose={() => {
						if (pending === null) {
							setError(undefined);
							setConfirmation(null);
						}
					}}
				/>
			)}
		</>
	);
}

function UserActionsMenu(props: {
	readonly id: string;
	readonly open: boolean;
	readonly note?: string;
	readonly activeIndex: number;
	readonly items: ReadonlyArray<MenuItem>;
	readonly backInterceptors: BackInterceptors;
	readonly onClose: (restoreFocus: boolean) => void;
	readonly onActiveIndexChange: (index: number) => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { open, backInterceptors } = props;
	const close = useEffectEvent((restoreFocus: boolean) => props.onClose(restoreFocus));

	useEffect(() => {
		if (!open) {
			return undefined;
		}
		return backInterceptors.register(() => {
			close(true);
			return true;
		});
	}, [backInterceptors, open]);

	return open ? (
		<Menu
			id={props.id}
			note={props.note}
			items={props.items}
			label="User actions"
			onClose={props.onClose}
			triggerRef={props.triggerRef}
			activeIndex={props.activeIndex}
			onActiveIndexChange={props.onActiveIndexChange}
		/>
	) : null;
}

function Badge(props: { readonly children: string; readonly tone?: "success" | "danger" }) {
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

const authLabel = (state: InstanceAdminUser["authState"]) =>
	({ oidc: "OIDC", none: "None", mixed: "Mixed", credential: "Password" })[state];

function ConfirmationDialog(props: {
	readonly error?: string;
	readonly pending: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly kind: "reset" | "delete";
	readonly backInterceptors: BackInterceptors;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	const close = useEffectEvent(() => props.onClose());
	const interceptBack = useEffectEvent(() => {
		if (props.pending) {
			return true;
		}
		close();
		return true;
	});

	useEffect(() => props.backInterceptors.register(interceptBack), [props.backInterceptors]);

	const reset = props.kind === "reset";
	let pendingLabel = reset ? "Reset account" : "Delete user";
	if (props.pending) {
		pendingLabel = reset ? "Resetting..." : "Deleting...";
	}

	return (
		<Modal
			closeLabel="Close"
			onClose={props.onClose}
			initialFocusRef={cancelRef}
			triggerRef={props.triggerRef}
			labelledBy="user-confirmation-title"
			onInterceptBack={() => props.pending}
			className="ui-card w-[min(100%,460px)]"
			containerClassName="items-center justify-center p-4"
		>
			<h2 id="user-confirmation-title" className="font-display text-xl font-semibold">
				{reset ? "Reset this user?" : "Delete this user?"}
			</h2>
			<p className="mt-3 text-sm text-text-muted">
				{reset
					? "This permanently deletes all user data, including progress, collections, and preferences. This cannot be undone."
					: "This permanently deletes the user and all of their data. This cannot be undone."}
			</p>
			{props.error && (
				<p role="alert" className="mt-3 text-sm text-danger">
					{props.error}
				</p>
			)}
			<div className="mt-6 flex justify-end gap-3">
				<Button
					type="button"
					ref={cancelRef}
					variant="secondary"
					onClick={props.onClose}
					disabled={props.pending}
				>
					Cancel
				</Button>
				<button
					type="button"
					disabled={props.pending}
					onClick={props.onConfirm}
					className="min-h-11 rounded-lg bg-danger-solid px-4 py-2.5 font-semibold text-danger-ink disabled:opacity-50"
				>
					{pendingLabel}
				</button>
			</div>
		</Modal>
	);
}
