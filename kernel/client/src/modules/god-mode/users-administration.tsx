import { Button, Menu, type MenuItem, Modal, useFieldEscape } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
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

import { isUnauthorizedCause } from "#/modules/god-mode/errors";
import type { ResetLinkTransfer } from "#/modules/god-mode/reset-link-transfer";
import type {
	GodModePasswordResetResult,
	GodModeSetDisabledResult,
	GodModeUser,
	GodModeUsers,
} from "#/modules/god-mode/service";
import type {
	GodModeUserLifecycleOperation,
	GodModeUserResetResult,
} from "#/modules/god-mode/user-lifecycle";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";

const PAGE_SIZE = 50;

type OperationResult<A> = Promise<Exit.Exit<A, unknown>>;
type Page =
	| { readonly offset: number; readonly state: "loading" | "error" }
	| { readonly offset: number; readonly state: "loaded"; readonly value: GodModeUsers };

type UserAction = "password" | "disabled" | "reset" | "delete";

function UserPageStatus(props: {
	readonly page: Extract<Page, { readonly state: "loading" | "error" }>;
	readonly onRetry: (offset: number) => void;
}) {
	if (props.page.state === "loading") {
		return <p role="status">Loading users...</p>;
	}
	return (
		<div className="grid justify-items-center gap-3">
			<p role="alert" className="text-danger">
				Could not load users. Check the server and try again.
			</p>
			<Button type="button" variant="secondary" onClick={() => props.onRetry(props.page.offset)}>
				Retry
			</Button>
		</div>
	);
}

export type GodModeUserOperations = {
	readonly resetUser: (userId: string) => OperationResult<GodModeUserResetResult>;
	readonly deleteUser: (userId: string) => OperationResult<GodModeUserLifecycleOperation>;
	readonly resetUserPassword: (userId: string) => OperationResult<GodModePasswordResetResult>;
	readonly setUserDisabled: (
		userId: string,
		disabled: boolean,
	) => OperationResult<GodModeSetDisabledResult>;
	readonly listUsers: (
		search: string,
		offset: number,
		limit: number,
	) => OperationResult<GodModeUsers>;
};

type UsersAdministrationProps = {
	readonly onUnauthorized: () => void;
	readonly operations: GodModeUserOperations;
	readonly backInterceptors: BackInterceptors;
	readonly transferResetLink: ResetLinkTransfer;
};

const formatDate = (value: string) =>
	new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

const userColumns: ReadonlyArray<DataTableColumn<GodModeUser>> = [
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
	const generation = useRef(0);
	const [search, setSearch] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	useFieldEscape(searchInput, { hasValue: search !== "", onClear: () => setSearch("") });
	const [query, setQuery] = useState("");
	const [pages, setPages] = useState<ReadonlyArray<Page>>([]);

	const loadPage = useEffectEvent(async (pageQuery: string, offset: number, version: number) => {
		const exit = await props.operations.listUsers(pageQuery, offset, PAGE_SIZE);
		if (generation.current !== version) {
			return;
		}
		if (Exit.isFailure(exit) && isUnauthorizedCause(exit.cause)) {
			props.onUnauthorized();
			return;
		}
		setPages((current) =>
			current.map((page) => {
				if (page.offset !== offset) {
					return page;
				}
				return Exit.isSuccess(exit)
					? { offset, state: "loaded", value: exit.value }
					: { offset, state: "error" };
			}),
		);
		if (Exit.isFailure(exit)) {
			logFailure("god-mode users request failed", exit.cause);
		}
	});

	useEffect(() => {
		const timer = setTimeout(() => setQuery(search.trim()), 300);
		return () => clearTimeout(timer);
	}, [search]);

	useEffect(() => {
		const version = generation.current + 1;
		generation.current = version;
		setPages([{ offset: 0, state: "loading" }]);
		void loadPage(query, 0, version);
		return () => {
			generation.current += 1;
		};
	}, [query]);

	const retry = (offset: number) => {
		setPages((current) =>
			current.map((page) => (page.offset === offset ? { offset, state: "loading" } : page)),
		);
		void loadPage(query, offset, generation.current);
	};
	const loadedPages = pages.filter(
		(page): page is Extract<Page, { state: "loaded" }> => page.state === "loaded",
	);
	const loaded = loadedPages.reduce((count, page) => count + page.value.users.length, 0);
	const total = loadedPages[0]?.value.total ?? 0;
	const last = pages.at(-1);
	const loadMore = () => {
		const offset = pages.length * PAGE_SIZE;
		setPages((current) => [...current, { offset, state: "loading" }]);
		void loadPage(query, offset, generation.current);
	};
	const updateUser = (userId: string, update: Partial<GodModeUser>) =>
		setPages((current) =>
			current.map((page) =>
				page.state !== "loaded"
					? page
					: {
							...page,
							value: {
								...page.value,
								users: page.value.users.map((user) =>
									user.id === userId ? { ...user, ...update } : user,
								),
							},
						},
			),
		);
	const removeUser = (userId: string) =>
		setPages((current) =>
			current.map((page) =>
				page.state !== "loaded"
					? page
					: {
							...page,
							value: {
								total: Math.max(0, page.value.total - 1),
								users: page.value.users.filter((user) => user.id !== userId),
							},
						},
			),
		);
	const submitSearch = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		setQuery(search.trim());
	};
	const bodyEndRows = pages.flatMap((page) =>
		page.state === "loaded"
			? []
			: [
					{
						id: String(page.offset),
						cellClassName: "px-2 py-10 text-center text-text-muted",
						content: <UserPageStatus page={page} onRetry={retry} />,
					},
				],
	);

	return (
		<section aria-labelledby="god-mode-users-title" className="ui-card max-w-6xl">
			<p className="ui-overline">Administration</p>
			<h1 id="god-mode-users-title" className="font-display text-3xl font-semibold">
				Users
			</h1>
			<p className="ui-subtitle">Manage account access, recovery, and user data.</p>
			<form className="mt-6 flex max-w-md gap-2" role="search" onSubmit={submitSearch}>
				<label className="sr-only" htmlFor="god-mode-user-search">
					Search users by email
				</label>
				<input
					type="search"
					value={search}
					ref={searchInput}
					id="god-mode-user-search"
					className="ui-field-input"
					placeholder="Search by email"
					onChange={(event) => setSearch(event.currentTarget.value)}
				/>
				<Button type="submit" variant="secondary">
					Search
				</Button>
			</form>
			<div className="mt-5 overflow-x-auto">
				<DataTable
					columns={userColumns}
					bodyEndRows={bodyEndRows}
					getRowId={(user) => user.id}
					className="w-full border-collapse text-left text-sm"
					data={loadedPages.flatMap((page) => page.value.users)}
					headerClassName="border-b border-border text-xs text-text-muted"
					renderRow={(user) => (
						<UserRow
							user={user}
							operations={props.operations}
							onUnauthorized={props.onUnauthorized}
							backInterceptors={props.backInterceptors}
							transferResetLink={props.transferResetLink}
							onRemoved={() => removeUser(user.id)}
							onChanged={(update) => updateUser(user.id, update)}
						/>
					)}
				/>
			</div>
			{last?.state === "loaded" && loaded === 0 && (
				<div className="py-12 text-center">
					<h2 className="font-display text-lg font-semibold">No users found</h2>
					<p className="mt-1 text-sm text-text-muted">
						{query === ""
							? "This server has no user accounts yet."
							: `No user email matches “${query}”.`}
					</p>
				</div>
			)}
			{last?.state === "loaded" && loaded > 0 && loaded < total && (
				<div className="mt-5 flex justify-center">
					<Button type="button" variant="secondary" onClick={loadMore}>
						Load more users
					</Button>
				</div>
			)}
		</section>
	);
}

function UserRow(props: {
	readonly user: GodModeUser;
	readonly onRemoved: () => void;
	readonly onUnauthorized: () => void;
	readonly operations: GodModeUserOperations;
	readonly backInterceptors: BackInterceptors;
	readonly transferResetLink: ResetLinkTransfer;
	readonly onChanged: (update: Partial<GodModeUser>) => void;
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
	const [pending, setPending] = useState<"password" | "disabled" | "reset" | "delete" | null>(null);
	const [result, setResult] = useState<GodModePasswordResetResult | GodModeUserResetResult | null>(
		null,
	);
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

	const run = async <A,>(
		kind: NonNullable<typeof pending>,
		operation: () => OperationResult<A>,
	) => {
		if (pendingRef.current !== null) {
			return null;
		}
		pendingRef.current = kind;
		setPending(kind);
		setError(undefined);
		const exit = await operation();
		pendingRef.current = null;
		setPending(null);
		if (Exit.isSuccess(exit)) {
			return exit.value;
		}
		if (isUnauthorizedCause(exit.cause)) {
			props.onUnauthorized();
		} else {
			logFailure(`god-mode user ${kind} request failed`, exit.cause);
		}
		return null;
	};
	const resetPassword = async () => {
		setCopied(false);
		setResult(null);
		const value = await run("password", () => props.operations.resetUserPassword(props.user.id));
		if (value !== null) {
			setResult(value);
		} else if (pendingRef.current === null) {
			setError("Could not generate a reset link. Try again.");
		}
	};
	const toggleDisabled = async () => {
		const value = await run("disabled", () =>
			props.operations.setUserDisabled(props.user.id, !isDisabled),
		);
		if (value !== null) {
			props.onChanged({ disabledAt: value.disabledAt });
		} else if (pendingRef.current === null) {
			setError(`Could not ${isDisabled ? "enable" : "disable"} this user. Try again.`);
		}
	};
	const confirm = async () => {
		setResult(null);
		const kind = confirmation;
		if (kind === null) {
			return;
		}
		if (kind === "reset") {
			const value = await run("reset", () => props.operations.resetUser(props.user.id));
			if (value === null) {
				if (pendingRef.current === null) {
					setError("Could not reset this user. Try again.");
				}
				return;
			}
			setConfirmation(null);
			setResult(value);
			return;
		}
		const value = await run("delete", () => props.operations.deleteUser(props.user.id));
		if (value === null) {
			if (pendingRef.current === null) {
				setError("Could not delete this user. Try again.");
			}
			return;
		}
		setConfirmation(null);
		props.onRemoved();
	};
	const transfer = async () => {
		if (result?.resetUrl == null) {
			return;
		}
		try {
			await props.transferResetLink(result.resetUrl);
			setCopied(true);
			copyTimer.current = setTimeout(() => setCopied(false), 2000);
		} catch (cause) {
			Effect.runSync(Effect.logWarning("god-mode reset link transfer failed", cause));
			setError("Could not copy or share the reset link. Try again.");
		}
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
		queueMicrotask(() => void (kind === "password" ? resetPassword() : toggleDisabled()));
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
						<AppIcon name="more-horizontal" size={18} />
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
										onClick={() => void transfer()}
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
					onConfirm={() => void confirm()}
					pending={pending === confirmation}
					backInterceptors={props.backInterceptors}
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

const authLabel = (state: GodModeUser["authState"]) =>
	({ credential: "Password", oidc: "OIDC", mixed: "Mixed", none: "None" })[state];

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
			triggerRef={props.triggerRef}
			initialFocusRef={cancelRef}
			className="ui-card w-[min(100%,460px)]"
			labelledBy="user-confirmation-title"
			onInterceptBack={() => props.pending}
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
