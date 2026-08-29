import { StatusMessage } from "@ryot-app/client-ui-sdk";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { ServerOrigin } from "#/api/origin";
import { AuthService } from "#/modules/auth/service";
import { AppIcon } from "#/modules/navigation/app-icon";
import { SettingsSection } from "#/modules/settings/settings-section";
import type { ClientRuntime } from "#/runtime";

export function AccountSession(props: {
	readonly server: ServerOrigin;
	readonly runtime: ClientRuntime;
}) {
	const navigate = useNavigate();
	const actionController = useRef(new AbortController());
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	useEffect(() => () => actionController.current.abort(), []);

	async function signOut() {
		const auth = props.runtime.runSync(AuthService);
		setPending(true);
		setError(undefined);
		const launched = await props.runtime
			.runPromise(auth.signOut(props.server), { signal: actionController.current.signal })
			.catch(() => null);
		if (launched === null) {
			if (!actionController.current.signal.aborted) {
				setPending(false);
				setError("Could not sign out.");
			}
			return;
		}
		if (!launched) {
			await navigate({ replace: true, to: "/auth", search: { redirect: undefined } });
		}
	}

	return (
		<SettingsSection title="Session" detail="Manage your current session.">
			<div className="flex flex-col gap-3">
				<button
					type="button"
					disabled={pending}
					onClick={() => void signOut()}
					className={clsx(
						"flex h-12 items-center gap-3 rounded-xl border border-border bg-surface px-4",
						pending && "opacity-60",
					)}
				>
					<AppIcon size={18} name="logout" className="text-danger" />
					<span className="flex-1 text-left text-sm font-medium text-danger">
						{pending ? "Signing out..." : "Sign out"}
					</span>
				</button>
				{error && <StatusMessage tone="error">{error}</StatusMessage>}
			</div>
		</SettingsSection>
	);
}
