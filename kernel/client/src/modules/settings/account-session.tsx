import { StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";

import { SettingsSection } from "#/modules/settings/settings-section";

export function AccountSession(props: {
	readonly failed: boolean;
	readonly isPending: boolean;
	readonly onSignOut: () => Promise<boolean>;
}) {
	const navigate = useNavigate();

	async function signOut() {
		const launched = await props.onSignOut().catch(() => null);
		if (launched === false) {
			await navigate({ replace: true, to: "/auth", search: { redirect: undefined } });
		}
	}

	return (
		<SettingsSection title="Session" detail="Manage your current session.">
			<div className="flex flex-col gap-3">
				<button
					type="button"
					disabled={props.isPending}
					onClick={() => void signOut()}
					className={clsx(
						"flex h-12 items-center gap-3 rounded-xl border border-border bg-surface px-4",
						props.isPending && "opacity-60",
					)}
				>
					<AppIcon size={18} name="logout" className="text-danger" />
					<span className="flex-1 text-left text-sm font-medium text-danger">
						{props.isPending ? "Signing out..." : "Sign out"}
					</span>
				</button>
				{props.failed && <StatusMessage tone="error">Could not sign out.</StatusMessage>}
			</div>
		</SettingsSection>
	);
}
