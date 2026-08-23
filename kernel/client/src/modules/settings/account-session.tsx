import { Button, StatusMessage } from "@ryot/client-ui-sdk";
import { useNavigate } from "@tanstack/react-router";
import type { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import type { ServerOrigin } from "#/api/origin";
import { AuthService } from "#/modules/auth/service";
import { SettingsSection } from "#/modules/settings/settings-section";
import type { ClientRuntime } from "#/runtime";

type SessionAction = "change-server" | "sign-out";

export function AccountSession(props: {
	readonly server: ServerOrigin;
	readonly runtime: ClientRuntime;
}) {
	const navigate = useNavigate();
	const actionController = useRef(new AbortController());
	const [pending, setPending] = useState<SessionAction>();
	const [error, setError] = useState<string>();
	useEffect(() => () => actionController.current.abort(), []);

	async function run(action: SessionAction, effect: Effect.Effect<void>) {
		setPending(action);
		setError(undefined);
		return await props.runtime.runPromise(effect, { signal: actionController.current.signal }).then(
			() => true,
			() => false,
		);
	}

	function reportFailure(message: string) {
		if (actionController.current.signal.aborted) {
			return;
		}
		setPending(undefined);
		setError(message);
	}

	async function signOut() {
		const auth = props.runtime.runSync(AuthService);
		setPending("sign-out");
		setError(undefined);
		const launched = await props.runtime
			.runPromise(auth.signOut(props.server), { signal: actionController.current.signal })
			.catch(() => null);
		if (launched === null) {
			return reportFailure("Could not sign out.");
		}
		if (!launched) {
			await navigate({ replace: true, to: "/auth", search: { redirect: undefined } });
		}
	}

	async function changeServer() {
		const auth = props.runtime.runSync(AuthService);
		if (!(await run("change-server", auth.changeServer(props.server)))) {
			reportFailure("Could not change server.");
			return;
		}
		await navigate({ replace: true, to: "/onboarding", search: { redirect: undefined } });
	}

	return (
		<SettingsSection title="Session" detail="Manage your current session.">
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap gap-3">
					<Button
						type="button"
						variant="secondary"
						disabled={pending !== undefined}
						onClick={() => void changeServer()}
					>
						{pending === "change-server" ? "Changing server…" : "Change server"}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={() => void signOut()}
						disabled={pending !== undefined}
					>
						{pending === "sign-out" ? "Signing out…" : "Sign out"}
					</Button>
				</div>
				{error && <StatusMessage tone="error">{error}</StatusMessage>}
			</div>
		</SettingsSection>
	);
}
