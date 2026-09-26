import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { useSyncExternalStore } from "react";

import type { AuthSessionStore } from "#/modules/auth/service";
import { Avatar } from "#/modules/navigation/avatar";
import { activateLink } from "#/modules/navigation/link-activation";

type AccountSummaryProps = {
	readonly isPro: boolean;
	readonly active: boolean;
	readonly session: AuthSessionStore;
	readonly onNavigate: () => void | Promise<void>;
};

export function AccountSummary(props: AccountSummaryProps) {
	const snapshot = useSyncExternalStore(
		props.session.subscribe,
		props.session.getSnapshot,
		props.session.getSnapshot,
	);
	if (snapshot.status !== "authenticated") {
		return null;
	}
	return (
		<a
			href="/settings"
			aria-label="Open settings"
			onClick={activateLink(props.onNavigate)}
			aria-current={props.active ? "page" : undefined}
			className={clsx(
				"flex items-center gap-2.5 rounded-md px-2 py-2",
				props.active ? "bg-nav-indicator" : "hover:bg-surface-2",
			)}
		>
			<span className="relative shrink-0">
				<Avatar name={snapshot.user.name} image={snapshot.user.image} />
				{props.isPro && (
					<span
						role="img"
						aria-label="Ryot Pro"
						className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border border-border bg-surface"
					>
						<AppIcon size={9} name="crown" className="text-accent-text" />
					</span>
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-text">{snapshot.user.name}</span>
				<span className="block truncate text-xs text-text-muted">{snapshot.user.email}</span>
			</span>
			<AppIcon size={15} name="settings" className="shrink-0 text-text-subtle" />
		</a>
	);
}
