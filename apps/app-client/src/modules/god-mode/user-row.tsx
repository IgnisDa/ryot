import clsx from "clsx";
import { Cause, Effect, Exit } from "effect";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Share, Text, TextInput, View } from "react-native";

import type {
	GodModeUser,
	GodModePasswordResetResult,
	GodModeSetDisabledResult,
} from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";
import type {
	GodModeUserLifecycleOperation,
	GodModeUserResetResult,
} from "@/modules/god-mode/user-lifecycle";
import { formatLocalDateLabel } from "@/modules/ui/date";
import { DestructiveActionSheet } from "@/modules/ui/destructive-action-sheet";

const authBadges = {
	oidc: { label: "OIDC", box: "bg-info-soft", text: "text-info" },
	none: { label: "None", box: "bg-surface-2", text: "text-text-subtle" },
	mixed: { label: "Mixed", box: "bg-accent-soft", text: "text-accent-text" },
	credential: { label: "Password", box: "bg-surface-2", text: "text-text-muted" },
} satisfies Record<GodModeUser["authState"], { box: string; text: string; label: string }>;

function StatusBadge(props: { disabledAt: string | null }) {
	const isDisabled = props.disabledAt !== null;

	return (
		<View
			className={clsx(
				"rounded-pill px-2.5 py-0.5",
				isDisabled ? "bg-surface-2" : "bg-success-soft",
			)}
		>
			<Text className={clsx("font-ui-medium text-xs", isDisabled ? "text-danger" : "text-success")}>
				{isDisabled ? "Disabled" : "Enabled"}
			</Text>
		</View>
	);
}

function AuthBadge(props: { state: GodModeUser["authState"] }) {
	const badge = authBadges[props.state];

	return (
		<View className={clsx("rounded-pill px-2.5 py-0.5", badge.box)}>
			<Text className={clsx("font-ui-medium text-xs", badge.text)}>{badge.label}</Text>
		</View>
	);
}

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
	readonly user: GodModeUser;
	readonly onUnauthorized: () => void;
	readonly actions: GodModeUserActions;
}) {
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

	const isDisabled = props.user.disabledAt !== null;
	const canReset = props.user.authState === "credential" || props.user.authState === "none";
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

	return (
		<View className="gap-2.5 border-b border-border py-3">
			<View className="flex-row items-start gap-3">
				<View className="min-w-0 flex-1 gap-0.5">
					<Text
						numberOfLines={1}
						className={clsx(
							"font-ui-medium text-[15px]",
							isDisabled ? "text-text-muted line-through" : "text-text",
						)}
					>
						{props.user.email}
					</Text>
					<Text className="font-ui text-[13px] text-text-muted" numberOfLines={1}>
						{props.user.name}
					</Text>
					{props.user.disabledAt && (
						<Text className="font-ui text-xs text-text-subtle">
							Disabled since {formatLocalDateLabel(props.user.disabledAt)}
						</Text>
					)}
				</View>
				<View className="shrink-0 flex-row items-center gap-1.5">
					<StatusBadge disabledAt={props.user.disabledAt} />
					<AuthBadge state={props.user.authState} />
				</View>
			</View>
			<View className="flex-row flex-wrap items-center gap-2">
				<Pressable
					accessibilityRole="button"
					disabled={!canReset || pending !== null}
					onPress={() => void handleGenerateResetLink()}
					accessibilityLabel={`Generate a password reset link for ${props.user.email}`}
					className={clsx(
						"rounded-lg bg-accent px-3 py-2",
						(!canReset || pending !== null) && "opacity-50",
					)}
				>
					<Text className="font-ui-medium text-[13px] text-accent-ink">
						{pending === "password" ? "Generating..." : "Generate reset link"}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={pending !== null}
					onPress={() => {
						setDestructiveError(undefined);
						setConfirmation("reset");
					}}
					accessibilityLabel={`Reset account for ${props.user.email}`}
					className={clsx(
						"rounded-lg border border-danger px-3 py-2",
						pending !== null && "opacity-50",
					)}
				>
					<Text className="font-ui-medium text-[13px] text-danger">
						{pending === "reset" ? "Resetting..." : "Reset account"}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={pending !== null}
					onPress={() => {
						setDestructiveError(undefined);
						setConfirmation("delete");
					}}
					accessibilityLabel={`Delete ${props.user.email}`}
					className={clsx(
						"rounded-lg border border-danger px-3 py-2",
						pending !== null && "opacity-50",
					)}
				>
					<Text className="font-ui-medium text-[13px] text-danger">
						{pending === "delete" ? "Deleting..." : "Delete user"}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={pending !== null}
					onPress={() => void handleToggleDisabled()}
					className={clsx(
						"rounded-lg border px-3 py-2",
						isDisabled ? "border-border-strong" : "border-danger",
						pending !== null && "opacity-50",
					)}
				>
					<Text
						className={clsx("font-ui-medium text-[13px]", isDisabled ? "text-text" : "text-danger")}
					>
						{disabledActionLabel}
					</Text>
				</Pressable>
				{!canReset && (
					<Text className="font-ui text-xs text-text-subtle">
						{props.user.authState === "oidc"
							? "OIDC-only user"
							: "Mixed auth — manual recovery needed"}
					</Text>
				)}
			</View>
			{error && <Text className="font-ui text-xs text-danger">{error}</Text>}
			{result?.resetUrl && (
				<View className="gap-2 rounded-lg border border-border bg-raised p-3">
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
				<Text className="font-ui text-xs text-success">
					Account reset completed. This user signs in through OIDC, so no password reset link was
					created.
				</Text>
			)}
			{confirmation === null ? null : (
				<DestructiveActionSheet
					snapPoints={[360]}
					pending={pending === confirmation}
					pendingLabel={confirmation === "reset" ? "Resetting..." : "Deleting..."}
					errorMessage={destructiveError}
					actionLabel={confirmation === "reset" ? "Reset account" : "Delete user"}
					title={confirmation === "reset" ? "Reset this user?" : "Delete this user?"}
					detail={
						confirmation === "reset"
							? "This permanently deletes all user data, including progress, collections, and preferences. This cannot be undone."
							: "This permanently deletes the user and all of their data. This cannot be undone."
					}
					onConfirm={() => void (confirmation === "reset" ? handleResetUser() : handleDeleteUser())}
					onClose={() => {
						setDestructiveError(undefined);
						setConfirmation(null);
					}}
				/>
			)}
		</View>
	);
}
