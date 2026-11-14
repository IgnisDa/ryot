import {
	Badge,
	Button,
	DestructiveConfirmation,
	LoadMoreButton,
	RowGroup,
	Skeleton,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { Effect } from "effect";
import { type ReactNode, useRef, useState } from "react";

import { LoadErrorState } from "#/modules/ui/load-error-state";

export type CredentialRow<Id extends string> = {
	readonly id: Id;
	readonly name: string;
	readonly icon: string;
	readonly detail: string;
	readonly access: string;
	readonly inactive?: boolean;
	readonly badges?: ReactNode;
	readonly secondary?: ReactNode;
};

export function CredentialList<Id extends string>(props: {
	readonly label: string;
	readonly empty: ReactNode;
	readonly isError: boolean;
	readonly isPending: boolean;
	readonly onRetry: () => void;
	readonly rows: readonly CredentialRow<Id>[];
	readonly loadMore: null | {
		readonly label: string;
		readonly onClick: () => void;
		readonly isFetchingNextPage: boolean;
	};
	readonly revoke: {
		readonly detail: string;
		readonly failed: boolean;
		readonly pending: boolean;
		readonly reset: () => void;
		readonly actionLabel: string;
		readonly errorMessage: string;
		readonly run: (id: Id) => Effect.Effect<unknown, unknown>;
	};
}) {
	const revokeTrigger = useRef<null | HTMLButtonElement>(null);
	const [revoking, setRevoking] = useState<null | CredentialRow<Id>>(null);

	if (props.isPending) {
		return (
			<RowGroup aria-busy="true" aria-label={`Loading ${props.label}`}>
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

	if (props.isError && props.rows.length === 0) {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title={`Could not load ${props.label}`}
				detail="Check your connection and try again."
			/>
		);
	}

	if (props.rows.length === 0) {
		return props.empty;
	}

	return (
		<>
			<RowGroup role="list" aria-label={props.label}>
				{props.rows.map((row) => (
					<div key={row.id} role="listitem" className="flex items-center gap-3 px-4 py-3.5">
						<span
							aria-hidden="true"
							className={clsx(
								"flex size-10 shrink-0 items-center justify-center rounded-lg",
								row.inactive === true
									? "bg-surface-2 text-text-subtle"
									: "bg-accent-soft text-accent-text",
							)}
						>
							<AppIcon size={18} name={row.icon} />
						</span>
						<div className="grid min-w-0 flex-1 gap-0.5">
							<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<span className="truncate text-sm font-medium text-text">{row.name}</span>
								<Badge size="sm" variant="outline">
									{row.access}
								</Badge>
								{row.badges}
							</div>
							{row.secondary}
							<p className="text-xs text-text-muted">{row.detail}</p>
						</div>
						<Button
							size="sm"
							variant="dangerGhost"
							aria-label={`Revoke ${row.name}`}
							onClick={(event) => {
								revokeTrigger.current = event.currentTarget;
								setRevoking(row);
							}}
						>
							Revoke
						</Button>
					</div>
				))}
			</RowGroup>
			{props.loadMore === null ? null : (
				<LoadMoreButton
					label={props.loadMore.label}
					onClick={props.loadMore.onClick}
					disabled={props.loadMore.isFetchingNextPage}
					isFetchingNextPage={props.loadMore.isFetchingNextPage}
				/>
			)}
			{revoking === null ? null : (
				<DestructiveConfirmation
					pendingLabel="Revoking..."
					triggerRef={revokeTrigger}
					detail={props.revoke.detail}
					pending={props.revoke.pending}
					title={`Revoke "${revoking.name}"?`}
					actionLabel={props.revoke.actionLabel}
					errorMessage={props.revoke.failed ? props.revoke.errorMessage : undefined}
					onClose={() => {
						props.revoke.reset();
						setRevoking(null);
					}}
					onConfirm={() =>
						void Effect.runPromise(
							props.revoke
								.run(revoking.id)
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
