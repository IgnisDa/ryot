import { FlexRender, type Row } from "@tanstack/react-table";
import clsx from "clsx";
import { Cause, Effect, Exit } from "effect";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Share, Text, TextInput, View } from "react-native";

import type {
	GodModePasswordResetResult,
	GodModeSetDisabledResult,
	GodModeUser,
} from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";
import type {
	GodModeUserLifecycleOperation,
	GodModeUserResetResult,
} from "@/modules/god-mode/user-lifecycle";
import type { godModeUserTableFeatures } from "@/modules/god-mode/user-table-model";
import { DestructiveActionSheet } from "@/modules/ui/destructive-action-sheet";
import { AppRowActionMenu } from "@/modules/ui/row-action-menu";

type GodModeAction<T> = () => Promise<Exit.Exit<T, unknown>>;

export type GodModeUserActions = {
	readonly resetUser: GodModeAction<GodModeUserResetResult>;
	readonly resetPassword: GodModeAction<GodModePasswordResetResult>;
	readonly deleteUser: GodModeAction<GodModeUserLifecycleOperation>;
	readonly setDisabled: (
		disabled: boolean,
	) => Promise<Exit.Exit<GodModeSetDisabledResult, unknown>>;
};

const logActionFailure = (label: string, cause: Cause.Cause<unknown>) =>
	Effect.runSync(Effect.logWarning(label, Cause.pretty(cause)));

export function GodModeUserRow(props: {
	readonly onUnauthorized: () => void;
	readonly actions: GodModeUserActions;
	readonly row: Row<typeof godModeUserTableFeatures, GodModeUser>;
}) {
	const user = props.row.original;
	const mounted = useRef(true);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pendingRef = useRef<"password" | "disabled" | "reset" | "delete" | null>(null);
	const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [destructiveError, setDestructiveError] = useState<string | undefined>();
	const [confirmation, setConfirmation] = useState<"reset" | "delete" | null>(null);
	const [pending, setPending] = useState<"password" | "disabled" | "reset" | "delete" | null>(null);
	const [result, setResult] = useState<GodModePasswordResetResult | GodModeUserResetResult | null>(
		null,
	);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (copyTimer.current) {
				clearTimeout(copyTimer.current);
			}
		};
	}, []);

	const isDisabled = user.disabledAt !== null;
	const canReset = user.authState === "credential" || user.authState === "none";
	let disabledActionLabel = isDisabled ? "Enable user" : "Disable user";
	if (pending === "disabled") {
		disabledActionLabel = isDisabled ? "Enabling..." : "Disabling...";
	}

	async function handleCopy() {
		if (!result?.resetUrl) {
			return;
		}
		if (Platform.OS === "web") {
			try {
				await navigator.clipboard.writeText(result.resetUrl);
			} catch {
				return;
			}
		} else {
			void Share.share({ message: result.resetUrl });
		}
		if (!mounted.current) {
			return;
		}
		setCopied(true);
		copyTimer.current = setTimeout(() => setCopied(false), 2000);
	}

	async function handleGenerateResetLink() {
		if (pendingRef.current !== null) {
			return;
		}
		pendingRef.current = "password";
		setCopied(false);
		setError(null);
		setResult(null);
		setPending("password");
		const response = await props.actions.resetPassword();
		pendingRef.current = null;
		if (!mounted.current) {
			return;
		}
		setPending(null);
		if (Exit.isSuccess(response)) {
			setResult(response.value);
		} else if (isUnauthorizedCause(response.cause)) {
			props.onUnauthorized();
		} else {
			logActionFailure("god-mode password reset request failed", response.cause);
			setError("Could not generate a reset link. Try again.");
		}
	}

	async function handleToggleDisabled() {
		if (pendingRef.current !== null) {
			return;
		}
		pendingRef.current = "disabled";
		setError(null);
		setPending("disabled");
		const response = await props.actions.setDisabled(!isDisabled);
		pendingRef.current = null;
		if (!mounted.current) {
			return;
		}
		setPending(null);
		if (Exit.isFailure(response)) {
			if (isUnauthorizedCause(response.cause)) {
				props.onUnauthorized();
			} else {
				logActionFailure("god-mode user status request failed", response.cause);
				setError(`Could not ${isDisabled ? "enable" : "disable"} this user. Try again.`);
			}
		}
	}

	async function handleResetUser() {
		if (pendingRef.current !== null) {
			return;
		}
		pendingRef.current = "reset";
		setCopied(false);
		setDestructiveError(undefined);
		setError(null);
		setResult(null);
		setPending("reset");
		const response = await props.actions.resetUser();
		pendingRef.current = null;
		if (!mounted.current) {
			return;
		}
		setPending(null);
		if (Exit.isSuccess(response)) {
			setConfirmation(null);
			setResult(response.value);
		} else if (isUnauthorizedCause(response.cause)) {
			props.onUnauthorized();
		} else {
			logActionFailure("god-mode user reset operation failed", response.cause);
			setDestructiveError("Could not reset this user. Try again.");
		}
	}

	async function handleDeleteUser() {
		if (pendingRef.current !== null) {
			return;
		}
		pendingRef.current = "delete";
		setDestructiveError(undefined);
		setError(null);
		setResult(null);
		setPending("delete");
		const response = await props.actions.deleteUser();
		pendingRef.current = null;
		if (!mounted.current) {
			return;
		}
		setPending(null);
		if (Exit.isSuccess(response)) {
			setConfirmation(null);
		} else if (isUnauthorizedCause(response.cause)) {
			props.onUnauthorized();
		} else {
			logActionFailure("god-mode user delete operation failed", response.cause);
			setDestructiveError("Could not delete this user. Try again.");
		}
	}

	let resetHint: string | undefined;
	if (!canReset) {
		resetHint =
			user.authState === "oidc" ? "OIDC-only user" : "Mixed auth — manual recovery needed";
	}
	return (
		<View className="border-b border-border">
			<View className="min-h-14 flex-row items-center gap-3 py-2 md:gap-4">
				{props.row.getAllCells().map((cell) => (
					<View key={cell.id} className={clsx(cell.column.columnDef.meta?.className)}>
						{cell.column.id === "actions" ? (
							<AppRowActionMenu
								note={resetHint}
								title="User actions"
								subject={user.email}
								items={[
									{
										disabled: !canReset || pending !== null,
										onPress: () => void handleGenerateResetLink(),
										label: pending === "password" ? "Generating..." : "Generate reset link",
									},
									{
										label: disabledActionLabel,
										disabled: pending !== null,
										isDestructive: !isDisabled,
										onPress: () => void handleToggleDisabled(),
									},
									{
										isDestructive: true,
										disabled: pending !== null,
										label: pending === "reset" ? "Resetting..." : "Reset account",
										onPress: () => {
											setDestructiveError(undefined);
											setConfirmation("reset");
										},
									},
									{
										isDestructive: true,
										disabled: pending !== null,
										label: pending === "delete" ? "Deleting..." : "Delete user",
										onPress: () => {
											setDestructiveError(undefined);
											setConfirmation("delete");
										},
									},
								]}
							/>
						) : (
							<FlexRender cell={cell} />
						)}
					</View>
				))}
			</View>
			{error && <Text className="pb-2 font-ui text-xs text-danger">{error}</Text>}
			{result?.resetUrl && (
				<View className="mb-3 gap-2 rounded-lg border border-border bg-raised p-3">
					<Text className="font-ui text-xs text-text-muted">Reset link for {result.email}</Text>
					<View className="flex-row items-center gap-2">
						<TextInput
							editable={false}
							autoCorrect={false}
							value={result.resetUrl}
							accessibilityLabel="Password reset link"
							className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-ui text-[13px] text-text"
						/>
						<Pressable
							disabled={copied}
							accessibilityRole="button"
							onPress={() => void handleCopy()}
							className={clsx(
								"rounded-lg border border-border-strong px-3 py-2",
								copied && "opacity-50",
							)}
						>
							<Text className="font-ui-medium text-[13px] text-text">
								{copied ? "Copied!" : "Copy"}
							</Text>
						</Pressable>
					</View>
				</View>
			)}
			{result?.resetUrl === null && (
				<Text className="pb-2 font-ui text-xs text-success">
					Account reset completed. This user signs in through OIDC, so no password reset link was
					created.
				</Text>
			)}
			{confirmation === null ? null : (
				<DestructiveActionSheet
					snapPoints={[360]}
					errorMessage={destructiveError}
					pending={pending === confirmation}
					pendingLabel={confirmation === "reset" ? "Resetting..." : "Deleting..."}
					actionLabel={confirmation === "reset" ? "Reset account" : "Delete user"}
					title={confirmation === "reset" ? "Reset this user?" : "Delete this user?"}
					onConfirm={() => void (confirmation === "reset" ? handleResetUser() : handleDeleteUser())}
					onClose={() => {
						setDestructiveError(undefined);
						setConfirmation(null);
					}}
					detail={
						confirmation === "reset"
							? "This permanently deletes all user data, including progress, collections, and preferences. This cannot be undone."
							: "This permanently deletes the user and all of their data. This cannot be undone."
					}
				/>
			)}
		</View>
	);
}
