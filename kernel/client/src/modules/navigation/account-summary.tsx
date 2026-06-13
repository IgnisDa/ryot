import clsx from "clsx";
import { useSyncExternalStore, type MouseEvent } from "react";

import type { AuthSessionStore } from "#/modules/auth/client";
import { AppIcon } from "#/modules/navigation/app-icon";
import { Avatar } from "#/modules/navigation/avatar";

type AccountSummaryProps = {
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
	const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
		if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return;
		}
		event.preventDefault();
		void props.onNavigate();
	};

	return (
		<a
			href="/settings"
			onClick={navigate}
			aria-label="Open settings"
			aria-current={props.active ? "page" : undefined}
			className={clsx(
				"flex items-center gap-2.5 rounded-md px-2 py-2",
				props.active ? "bg-nav-indicator" : "hover:bg-surface-2",
			)}
		>
			<Avatar name={snapshot.user.name} image={snapshot.user.image} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-text">{snapshot.user.name}</span>
				<span className="block truncate text-xs text-text-muted">{snapshot.user.email}</span>
			</span>
			<AppIcon name="settings" size={15} className="shrink-0 text-text-subtle" />
		</a>
	);
}
