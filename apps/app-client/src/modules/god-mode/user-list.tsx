import { useAtomSet } from "@effect/atom-react";
import { Text, View } from "react-native";

import {
	deleteUserAtom,
	type GodModeScope,
	type GodModeUser,
	resetUserAtom,
	resetUserPasswordAtom,
	setUserDisabledAtom,
} from "@/modules/god-mode/atoms";
import { GodModeUserRow } from "@/modules/god-mode/user-row";

function UserRow(props: {
	readonly user: GodModeUser;
	readonly scope: GodModeScope;
	readonly onUnauthorized: () => void;
}) {
	const request = {
		...props.scope,
		userId: props.user.id,
	};
	const deleteUser = useAtomSet(deleteUserAtom(request), { mode: "promiseExit" });
	const resetUser = useAtomSet(resetUserAtom(request), { mode: "promiseExit" });
	const resetPassword = useAtomSet(resetUserPasswordAtom(request), { mode: "promiseExit" });
	const setDisabled = useAtomSet(setUserDisabledAtom(request), { mode: "promiseExit" });

	return (
		<GodModeUserRow
			user={props.user}
			onUnauthorized={props.onUnauthorized}
			actions={{ deleteUser, resetUser, resetPassword, setDisabled }}
		/>
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
