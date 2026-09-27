import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { useState } from "react";

import type { SchemaOAuthConnect, SchemaOAuthConnectOutcome } from "./connect";
import { SchemaOAuthField } from "./field";

const DEMO_MESSAGE = "This operation is unavailable while using the shared demo account.";

const deferredConnect = () => {
	const signals: AbortSignal[] = [];
	const requests: { readonly field: string; readonly provider: string }[] = [];
	const settlers: Array<PromiseWithResolvers<SchemaOAuthConnectOutcome>> = [];
	const connect: SchemaOAuthConnect = (request) => {
		signals.push(request.signal);
		requests.push({ field: request.field, provider: request.provider });
		const deferred = Promise.withResolvers<SchemaOAuthConnectOutcome>();
		settlers.push(deferred);
		return deferred.promise;
	};
	return {
		connect,
		signals,
		requests,
		resolve: (index: number, outcome: SchemaOAuthConnectOutcome) =>
			settlers[index]?.resolve(outcome),
	};
};

function OAuthFieldHarness(props: {
	readonly initial?: string;
	readonly disabledReason?: string;
	readonly connect: SchemaOAuthConnect;
	readonly onChange: (connectionId: string) => void;
}) {
	const [value, setValue] = useState<string | undefined>(props.initial);
	return (
		<SchemaOAuthField
			value={value}
			field="account"
			label="Account"
			provider="spotify"
			connect={props.connect}
			disabledReason={props.disabledReason}
			onChange={(connectionId) => {
				setValue(connectionId);
				props.onChange(connectionId);
			}}
		/>
	);
}

const settle = () => Effect.sleep("5 millis");

describe("SchemaOAuthField", () => {
	it.live("calls connect within the click and binds the returned connection", () =>
		Effect.gen(function* () {
			const connect = deferredConnect();
			const changes: string[] = [];
			render(<OAuthFieldHarness connect={connect.connect} onChange={(id) => changes.push(id)} />);

			fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));

			expect(connect.requests).toEqual([{ field: "account", provider: "spotify" }]);
			expect(screen.getByText("Waiting for authorization…")).toBeTruthy();
			expect(screen.getByLabelText("Connecting Account").getAttribute("aria-busy")).toBe("true");

			connect.resolve(0, { kind: "connected", connectionId: "connection-1" });

			expect(yield* Effect.promise(() => screen.findByText("Connected"))).toBeTruthy();
			expect(screen.getByRole("button", { name: "Connect again Account" })).toBeTruthy();
			expect(changes).toEqual(["connection-1"]);
		}),
	);

	it.live("shows a failure and keeps the current connection", () =>
		Effect.gen(function* () {
			const connect = deferredConnect();
			const changes: string[] = [];
			render(
				<OAuthFieldHarness
					initial="connection-1"
					connect={connect.connect}
					onChange={(id) => changes.push(id)}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Connect again Account" }));
			connect.resolve(0, { kind: "failed", message: "Allow pop-ups to connect" });

			const alert = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(alert.textContent).toBe("Allow pop-ups to connect");
			expect(screen.getByText("Connected")).toBeTruthy();
			expect(changes).toEqual([]);

			fireEvent.click(screen.getByRole("button", { name: "Connect again Account" }));
			expect(connect.requests).toHaveLength(2);
		}),
	);

	it.live("leaves the value alone when the attempt is cancelled", () =>
		Effect.gen(function* () {
			const connect = deferredConnect();
			const changes: string[] = [];
			render(<OAuthFieldHarness connect={connect.connect} onChange={(id) => changes.push(id)} />);

			fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
			connect.resolve(0, { kind: "cancelled" });

			expect(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Connect Account" })),
			).toBeTruthy();
			expect(screen.queryByText("Connected")).toBeNull();
			expect(screen.queryByRole("alert")).toBeNull();
			expect(changes).toEqual([]);
		}),
	);

	it.live("replaces the bound connection when connecting again", () =>
		Effect.gen(function* () {
			const connect = deferredConnect();
			const changes: string[] = [];
			render(
				<OAuthFieldHarness
					initial="connection-1"
					connect={connect.connect}
					onChange={(id) => changes.push(id)}
				/>,
			);

			expect(screen.getByText("Connected")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Connect again Account" }));
			connect.resolve(0, { kind: "connected", connectionId: "connection-2" });

			expect(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Connect again Account" })),
			).toBeTruthy();
			expect(changes).toEqual(["connection-2"]);
		}),
	);

	it.live("aborts on Cancel and ignores the late result of that attempt", () =>
		Effect.gen(function* () {
			const connect = deferredConnect();
			const changes: string[] = [];
			render(<OAuthFieldHarness connect={connect.connect} onChange={(id) => changes.push(id)} />);

			fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
			fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
			expect(connect.signals[0]?.aborted).toBe(true);

			fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
			expect(connect.signals[1]?.aborted).toBe(false);
			connect.resolve(0, { kind: "connected", connectionId: "stale" });
			yield* settle();
			expect(changes).toEqual([]);
			expect(screen.getByText("Waiting for authorization…")).toBeTruthy();

			connect.resolve(1, { kind: "connected", connectionId: "connection-2" });
			yield* Effect.promise(() => screen.findByText("Connected"));
			expect(changes).toEqual(["connection-2"]);
		}),
	);

	it.live("aborts the attempt on unmount and ignores its result", () =>
		Effect.gen(function* () {
			const connect = deferredConnect();
			const changes: string[] = [];
			const view = render(
				<OAuthFieldHarness connect={connect.connect} onChange={(id) => changes.push(id)} />,
			);

			fireEvent.click(screen.getByRole("button", { name: "Connect Account" }));
			view.unmount();

			expect(connect.signals[0]?.aborted).toBe(true);
			connect.resolve(0, { kind: "connected", connectionId: "connection-1" });
			yield* settle();
			expect(changes).toEqual([]);
		}),
	);

	it("explains a disabled connect control and never starts an attempt", () => {
		const connect = deferredConnect();
		render(
			<OAuthFieldHarness
				connect={connect.connect}
				onChange={() => undefined}
				disabledReason={DEMO_MESSAGE}
			/>,
		);

		const button = screen.getByRole("button", { name: "Connect Account" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText(DEMO_MESSAGE)).toBeTruthy();

		fireEvent.click(button);

		expect(connect.requests).toEqual([]);
	});
});
