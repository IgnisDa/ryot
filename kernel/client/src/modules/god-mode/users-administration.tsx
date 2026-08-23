import { Button } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { Cause, Effect, Exit } from "effect";
import {
	type KeyboardEvent,
	type RefObject,
	type SyntheticEvent,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

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
const focusable =
	'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type OperationResult<A> = Promise<Exit.Exit<A, unknown>>;
type Page =
	| { readonly offset: number; readonly state: "loading" | "error" }
	| { readonly offset: number; readonly state: "loaded"; readonly value: GodModeUsers };

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

const logFailure = (label: string, cause: Cause.Cause<unknown>) =>
	Effect.runSync(Effect.logWarning(label, Cause.pretty(cause)));

export function UsersAdministration(props: UsersAdministrationProps) {
	const generation = useRef(0);
	const [search, setSearch] = useState("");
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
				<table className="w-full border-collapse text-left text-sm">
					<thead className="border-b border-border text-xs text-text-muted">
						<tr>
							<th scope="col" className="px-2 py-3 font-semibold">
								Email
							</th>
							<th scope="col" className="hidden px-2 py-3 font-semibold md:table-cell">
								Name
							</th>
							<th scope="col" className="hidden px-2 py-3 font-semibold md:table-cell">
								Auth
							</th>
							<th scope="col" className="px-2 py-3 font-semibold">
								Status
							</th>
							<th scope="col" className="hidden px-2 py-3 font-semibold lg:table-cell">
								Created
							</th>
							<th scope="col" className="px-2 py-3 font-semibold">
								Actions
							</th>
						</tr>
					</thead>
					<tbody>
						{pages.map((page) =>
							page.state === "loaded" ? (
								page.value.users.map((user) => (
									<UserRow
										user={user}
										key={user.id}
										operations={props.operations}
										onUnauthorized={props.onUnauthorized}
										backInterceptors={props.backInterceptors}
										transferResetLink={props.transferResetLink}
										onRemoved={() => removeUser(user.id)}
										onChanged={(update) => updateUser(user.id, update)}
									/>
								))
							) : (
								<tr key={page.offset}>
									<td colSpan={6} className="px-2 py-10 text-center text-text-muted">
										{page.state === "loading" ? (
											<p role="status">Loading users...</p>
										) : (
											<div className="grid justify-items-center gap-3">
												<p role="alert" className="text-danger">
													Could not load users. Check the server and try again.
												</p>
												<Button
													type="button"
													variant="secondary"
													onClick={() => retry(page.offset)}
												>
													Retry
												</Button>
											</div>
										)}
									</td>
								</tr>
							),
						)}
					</tbody>
				</table>
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
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string>();
	const [confirmation, setConfirmation] = useState<"reset" | "delete" | null>(null);
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
	let disabledActionLabel = isDisabled ? "Enable" : "Disable";
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
				<td className="min-w-44 px-2 py-3">
					<div className="flex flex-wrap gap-x-3 gap-y-1">
						<button
							type="button"
							disabled={!canResetPassword || pending !== null}
							onClick={() => void resetPassword()}
							className="min-h-9 text-xs font-semibold text-accent-text disabled:text-text-subtle"
						>
							{pending === "password" ? "Generating..." : "Reset password"}
						</button>
						<button
							type="button"
							disabled={pending !== null}
							onClick={() => void toggleDisabled()}
							className={clsx(
								"min-h-9 text-xs font-semibold",
								isDisabled ? "text-accent-text" : "text-danger",
							)}
						>
							{disabledActionLabel}
						</button>
						<button
							type="button"
							ref={triggerRef}
							disabled={pending !== null}
							className="min-h-9 text-xs font-semibold text-danger"
							onClick={() => {
								setError(undefined);
								setConfirmation("reset");
							}}
						>
							Reset account
						</button>
						<button
							type="button"
							disabled={pending !== null}
							className="min-h-9 text-xs font-semibold text-danger"
							onClick={(event) => {
								triggerRef.current = event.currentTarget;
								setError(undefined);
								setConfirmation("delete");
							}}
						>
							Delete
						</button>
					</div>
					{resetNote && <p className="max-w-52 pb-1 text-xs text-text-subtle">{resetNote}</p>}
				</td>
			</tr>
			{(error !== undefined || result !== null) && (
				<tr className="border-b border-border">
					<td colSpan={6} className="px-2 pt-0 pb-4">
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
								<label className="text-xs text-text-muted">
									Reset link for {result.email}
									<input
										readOnly
										value={result.resetUrl}
										aria-label="Password reset link"
										className="ui-field-input mt-1 text-sm"
									/>
								</label>
								<Button
									type="button"
									disabled={copied}
									variant="secondary"
									className="justify-self-start"
									onClick={() => void transfer()}
								>
									{copied ? "Copied!" : "Copy or share"}
								</Button>
							</div>
						)}
					</td>
				</tr>
			)}
			{confirmation &&
				createPortal(
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
					/>,
					document.body,
				)}
		</>
	);
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
	const dialogRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const close = useEffectEvent(() => props.onClose());

	useEffect(() => {
		cancelRef.current?.focus();
		const trigger = props.triggerRef.current;
		const unregister = props.backInterceptors.register(() => {
			if (props.pending) {
				return true;
			}
			close();
			return true;
		});
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			unregister();
			document.body.style.overflow = overflow;
			queueMicrotask(() => trigger?.focus());
		};
	}, [props.backInterceptors, props.pending, props.triggerRef]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape" && !props.pending) {
			event.preventDefault();
			props.onClose();
			return;
		}
		if (event.key !== "Tab") {
			return;
		}
		const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
		if (items.length === 0) {
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	const reset = props.kind === "reset";
	let pendingLabel = reset ? "Reset account" : "Delete user";
	if (props.pending) {
		pendingLabel = reset ? "Resetting..." : "Deleting...";
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			onKeyDown={onKeyDown}
			aria-labelledby="user-confirmation-title"
			className="fixed inset-0 z-50 grid place-items-center bg-overlay p-4"
		>
			<div ref={dialogRef} className="ui-card w-[min(100%,460px)]">
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
						className="min-h-11 rounded-lg bg-danger px-4 py-2.5 font-semibold text-white disabled:opacity-50"
					>
						{pendingLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
