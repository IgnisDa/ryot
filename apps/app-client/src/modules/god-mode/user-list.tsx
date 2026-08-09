import { useAtomSet } from "@effect/atom-react";
import { dayjs } from "@ryot/ts-utils/dayjs";
import clsx from "clsx";
import { Exit } from "effect";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Share, Text, TextInput, View } from "react-native";

import {
	type GodModeScope,
	type GodModeUser,
	resetUserPasswordAtom,
	setUserDisabledAtom,
} from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";

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

function UserRow(props: {
	readonly user: GodModeUser;
	readonly scope: GodModeScope;
	readonly onUnauthorized: () => void;
}) {
	const mounted = useRef(true);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [pending, setPending] = useState<"reset" | "disabled" | null>(null);
	const [result, setResult] = useState<{ email: string; resetUrl: string } | null>(null);
	const request = {
		...props.scope,
		userId: props.user.id,
	};
	const resetPassword = useAtomSet(resetUserPasswordAtom(request), { mode: "promiseExit" });
	const setUserDisabled = useAtomSet(setUserDisabledAtom(request), { mode: "promiseExit" });

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
		if (!result) {
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
		setCopied(false);
		setError(null);
		setResult(null);
		setPending("reset");
		const response = await resetPassword();
		if (!mounted.current) {
			return;
		}
		setPending(null);
		if (Exit.isSuccess(response)) {
			setResult(response.value);
		} else if (isUnauthorizedCause(response.cause)) {
			props.onUnauthorized();
		} else {
			setError("Could not generate a reset link. Try again.");
		}
	}

	async function handleToggleDisabled() {
		setError(null);
		setPending("disabled");
		const response = await setUserDisabled(!isDisabled);
		if (!mounted.current) {
			return;
		}
		setPending(null);
		if (Exit.isFailure(response)) {
			if (isUnauthorizedCause(response.cause)) {
				props.onUnauthorized();
			} else {
				setError(`Could not ${isDisabled ? "enable" : "disable"} this user. Try again.`);
			}
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
							Disabled since {dayjs(props.user.disabledAt).format("MMM D, YYYY")}
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
						{pending === "reset" ? "Generating..." : "Generate reset link"}
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
			{result && (
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
		</View>
	);
}

export function GodModeUserList(props: {
	readonly scope: GodModeScope;
	readonly onUnauthorized: () => void;
	readonly users: readonly GodModeUser[];
}) {
	if (props.users.length === 0) {
		return (
			<View className="items-center rounded-xl border border-border bg-surface p-6">
				<Text className="font-ui text-sm text-text-muted">No users found</Text>
			</View>
		);
	}

	return (
		<View className="border-t border-border">
			{props.users.map((user) => (
				<UserRow
					user={user}
					key={user.id}
					scope={props.scope}
					onUnauthorized={props.onUnauthorized}
				/>
			))}
		</View>
	);
}
