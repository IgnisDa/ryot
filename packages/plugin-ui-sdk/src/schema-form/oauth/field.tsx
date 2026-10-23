import * as Effect from "effect/Effect";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "../../index";
import { FieldMessage } from "../../text-field";
import type { SchemaOAuthConnect, SchemaOAuthConnectOutcome } from "./connect";

const CONNECT_FAILURE_MESSAGE = "Couldn't connect. Try again.";

type SchemaOAuthState =
	| { readonly status: "idle" }
	| { readonly status: "connecting" }
	| { readonly status: "failed"; readonly message: string };

export function SchemaOAuthField(props: {
	readonly field: string;
	readonly label: string;
	readonly provider: string;
	readonly value: string | undefined;
	readonly connect: SchemaOAuthConnect;
	readonly disabledReason?: string | undefined;
	readonly onChange: (connectionId: string) => void;
}) {
	const attempt = useRef(0);
	const controller = useRef<AbortController | undefined>(undefined);
	const [state, setState] = useState<SchemaOAuthState>({ status: "idle" });

	const abortAttempt = () => {
		attempt.current = attempt.current + 1;
		controller.current?.abort();
		controller.current = undefined;
	};

	useLayoutEffect(
		() => () => {
			attempt.current = attempt.current + 1;
			controller.current?.abort();
		},
		[],
	);

	const settle = (token: number, outcome: SchemaOAuthConnectOutcome) => {
		if (token !== attempt.current) {
			return;
		}
		controller.current = undefined;
		if (outcome.kind === "failed") {
			setState({ status: "failed", message: outcome.message });
			return;
		}
		setState({ status: "idle" });
		if (outcome.kind === "connected") {
			props.onChange(outcome.connectionId);
		}
	};

	const start = () => {
		if (props.disabledReason !== undefined) {
			return;
		}
		abortAttempt();
		const token = attempt.current;
		const next = new AbortController();
		controller.current = next;
		const pending = props.connect({
			field: props.field,
			signal: next.signal,
			provider: props.provider,
		});
		setState({ status: "connecting" });
		void Effect.runPromise(
			Effect.tryPromise(() => pending).pipe(
				Effect.orElseSucceed((): SchemaOAuthConnectOutcome => ({
					kind: "failed",
					message: CONNECT_FAILURE_MESSAGE,
				})),
				Effect.map((outcome) => settle(token, outcome)),
			),
		);
	};

	const cancel = () => {
		abortAttempt();
		setState({ status: "idle" });
	};

	const isConnected = props.value !== undefined && props.value !== "";

	return (
		<div className="flex flex-col gap-1.5">
			{state.status === "connecting" ? (
				<div className="flex flex-row items-center gap-2">
					<span
						role="status"
						aria-busy="true"
						aria-label={`Connecting ${props.label}`}
						className="h-4 w-4 shrink-0 rounded-pill border-2 border-border-strong border-t-accent"
					/>
					<span className="min-w-0 flex-1 text-sm text-text-muted">Waiting for authorization…</span>
					<Button type="button" onClick={cancel} variant="secondary">
						Cancel
					</Button>
				</div>
			) : (
				<div className="flex flex-row items-center gap-2">
					{isConnected ? (
						<span className="min-w-0 flex-1 text-sm font-medium text-text">Connected</span>
					) : null}
					<Button
						type="button"
						onClick={start}
						className="self-start"
						disabled={props.disabledReason !== undefined}
						variant={isConnected ? "secondary" : "primary"}
						aria-label={`${isConnected ? "Connect again" : "Connect"} ${props.label}`}
					>
						{isConnected ? "Connect again" : "Connect"}
					</Button>
				</div>
			)}
			{props.disabledReason === undefined ? null : (
				<span className="text-xs text-text-subtle">{props.disabledReason}</span>
			)}
			{state.status === "failed" ? <FieldMessage>{state.message}</FieldMessage> : null}
		</div>
	);
}
