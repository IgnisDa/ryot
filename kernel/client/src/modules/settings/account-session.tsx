import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { formatError } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { Effect } from "effect";

import { SettingsSection } from "#/modules/settings/settings-section";

export function AccountSession(props: {
	readonly isPending: boolean;
	readonly error: null | Error;
	readonly onSignOut: () => Effect.Effect<boolean, Error>;
}) {
	const t = useT();
	const navigate = useNavigate();

	function signOut() {
		return Effect.runPromise(
			props.onSignOut().pipe(
				Effect.catchCause(() => Effect.succeed(null)),
				Effect.tap((launched) =>
					launched === false
						? Effect.sync(() => {
								void navigate({ to: "/auth", replace: true, search: { redirect: undefined } });
							})
						: Effect.void,
				),
				Effect.asVoid,
			),
		);
	}

	return (
		<SettingsSection
			title={t(kernelMessage("client.settings.account.session.title"))}
			detail={t(kernelMessage("client.settings.account.session.detail"))}
		>
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
						{t(
							props.isPending
								? kernelMessage("client.settings.account.session.signing-out")
								: kernelMessage("common.action.sign-out"),
						)}
					</span>
				</button>
				{props.error !== null && (
					<StatusMessage tone="error">
						{formatError(t, props.error, kernelMessage("client.settings.account.session.failed"))}
					</StatusMessage>
				)}
			</div>
		</SettingsSection>
	);
}
