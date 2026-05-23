export type ConnectionState =
	| { readonly status: "idle" }
	| { readonly status: "error" }
	| { readonly status: "success" }
	| { readonly status: "checking" };

export type ConnectionAction =
	| { readonly type: "failed" }
	| { readonly type: "changed" }
	| { readonly type: "started" }
	| { readonly type: "succeeded" };

export const initialConnectionState: ConnectionState = { status: "idle" };

export function reduceConnectionState(
	_state: ConnectionState,
	action: ConnectionAction,
): ConnectionState {
	if (action.type === "started") {
		return { status: "checking" };
	}
	if (action.type === "failed") {
		return { status: "error" };
	}
	if (action.type === "succeeded") {
		return { status: "success" };
	}
	return initialConnectionState;
}
