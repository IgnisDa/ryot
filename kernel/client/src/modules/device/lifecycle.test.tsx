import { expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PluginNavigationTarget } from "@ryot-app/plugin-client-contract";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Layer, ManagedRuntime } from "effect";

import { decodeServerOrigin } from "#/api/origin";
import { DeviceScope, ReturnShortcutBar } from "#/modules/device/lifecycle";
import { noopDevicePlatform } from "#/modules/device/platform.test-layer";
import { DevicePlatform, DeviceService } from "#/modules/device/service";
import { type DeviceState, emptyDeviceState } from "#/modules/device/state";
import { makeClientStorage } from "#/persistence/storage.test-layer";

const storage = (read: () => DeviceState, write: (state: DeviceState) => void) =>
	makeClientStorage({
		getDeviceState: Effect.sync(read),
		setDeviceState: (state) => Effect.sync(() => write(state)),
	});

it.live("does not cancel alerts when navigation replaces an equivalent scope object", () =>
	Effect.gen(function* () {
		let stored: DeviceState = emptyDeviceState;
		const cancelled: number[] = [];
		const platform = Layer.succeed(DevicePlatform, {
			...noopDevicePlatform,
			schedule: () => Effect.succeed({ status: "scheduled" }),
			cancel: (id) =>
				Effect.sync(() => {
					cancelled.push(id);
				}),
		});
		const runtime = ManagedRuntime.make(
			DeviceService.layer.pipe(
				Layer.provide(platform),
				Layer.provide(
					storage(
						() => stored,
						(state) => (stored = state),
					),
				),
			),
		);
		const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://one.test") };
		const pluginId = PluginId.make("other");
		const packageId = PluginPackageId.make("ryot/other");
		const contributors = [
			{
				pluginId,
				packageId,
				kind: "plugin",
				contentHash: "hash",
				revisionId: "revision",
				installationId: "installation-1",
			},
		] as const;
		const view = render(<DeviceScope scope={scope} runtime={runtime} onNavigate={() => {}} />);
		try {
			yield* runtime
				.runSync(DeviceService)
				.outcome(scope, contributors, "frame", true, {
					pluginId,
					body: "",
					key: "rest",
					audible: true,
					action: "schedule",
					title: "Rest complete",
					deadline: "2030-01-01T00:00:00.000Z",
					target: { packageId, search: "", path: "/editor", kind: "plugin-route" },
				});
			view.rerender(<DeviceScope runtime={runtime} scope={{ ...scope }} onNavigate={() => {}} />);
			expect(cancelled).toEqual([]);
			view.rerender(
				<DeviceScope
					runtime={runtime}
					onNavigate={() => {}}
					scope={{ ...scope, userId: "user-2" }}
				/>,
			);
			expect(cancelled).toEqual([1]);
		} finally {
			cleanup();
			yield* runtime.disposeEffect;
		}
	}),
);

it.live(
	"restores return shortcuts only for their authenticated scope, hides them on their target, and clears them explicitly",
	() =>
		Effect.gen(function* () {
			let stored: DeviceState = emptyDeviceState;
			const platform = Layer.succeed(DevicePlatform, noopDevicePlatform);
			const makeRuntime = () =>
				ManagedRuntime.make(
					DeviceService.layer.pipe(
						Layer.provide(platform),
						Layer.provide(
							storage(
								() => stored,
								(state) => (stored = state),
							),
						),
					),
				);
			const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://one.test") };
			const pluginId = PluginId.make("other");
			const packageId = PluginPackageId.make("ryot/other");
			const contributors = [
				{
					pluginId,
					packageId,
					kind: "plugin",
					contentHash: "hash",
					revisionId: "revision",
					installationId: "installation-1",
				},
			] as const;
			const target: PluginNavigationTarget = {
				packageId,
				search: "",
				path: "/editor",
				kind: "plugin-route",
			};
			const first = makeRuntime();
			const service = first.runSync(DeviceService);
			yield* service.setScope(scope);
			yield* service.outcome(scope, contributors, "frame", true, {
				pluginId,
				action: "return-shortcut",
				shortcut: { target, label: "Resume session" },
			});
			yield* first.disposeEffect;
			const restored = makeRuntime();
			const restoredService = restored.runSync(DeviceService);
			yield* restoredService.setScope(scope);
			const navigations: PluginNavigationTarget[] = [];
			const view = render(
				<ReturnShortcutBar
					runtime={restored}
					safeAreaBottom={16}
					isCurrent={() => false}
					scope={{ ...scope, userId: "user-2" }}
					onNavigate={(to) => navigations.push(to)}
				/>,
			);
			try {
				expect(view.queryByRole("button", { name: "Resume session" })).toBeNull();
				view.rerender(
					<ReturnShortcutBar
						scope={scope}
						runtime={restored}
						safeAreaBottom={16}
						onNavigate={(to) => navigations.push(to)}
						isCurrent={(current) => current.kind === "plugin-route" && current.path === "/editor"}
					/>,
				);
				expect(view.queryByRole("button", { name: "Resume session" })).toBeNull();
				view.rerender(
					<ReturnShortcutBar
						scope={scope}
						runtime={restored}
						safeAreaBottom={16}
						isCurrent={() => false}
						onNavigate={(to) => navigations.push(to)}
					/>,
				);
				yield* Effect.promise(() =>
					userEvent.setup().click(view.getByRole("button", { name: "Resume session" })),
				);
				expect(navigations).toEqual([target]);
				view.unmount();
				yield* restoredService.outcome(scope, contributors, "frame", true, {
					pluginId,
					shortcut: null,
					action: "return-shortcut",
				});
				expect(stored.shortcuts).toEqual([]);
			} finally {
				cleanup();
				yield* restored.disposeEffect;
			}
		}),
);
