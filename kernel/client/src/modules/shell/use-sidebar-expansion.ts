import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";

import type { ApiScope } from "#/api/scope";
import type { SidebarSectionName } from "#/modules/shell/sidebar-sections";
import { ClientStorage } from "#/persistence/storage";
import type { ClientRuntime } from "#/runtime";

type Expansion = Partial<Record<SidebarSectionName, boolean>>;

const sections: readonly SidebarSectionName[] = ["views", "savedViews", "collections"];

export function useSidebarExpansion(input: {
	readonly scope: ApiScope;
	readonly workspace: string;
	readonly runtime: ClientRuntime;
}) {
	const { scope, runtime, workspace } = input;
	const [state, setState] = useState<{ readonly workspace: string; readonly expanded: Expansion }>({
		workspace,
		expanded: {},
	});

	useEffect(() => {
		const fiber = runtime.runFork(
			Effect.flatMap(ClientStorage, (storage) =>
				Effect.forEach(sections, (section) =>
					storage.getSidebarSectionExpanded(scope, workspace, section),
				),
			).pipe(
				Effect.tap((stored) =>
					Effect.sync(() =>
						setState({
							workspace,
							expanded: Object.fromEntries(
								sections.flatMap((section, index) => {
									const value = stored[index];
									return value === null ? [] : [[section, value]];
								}),
							),
						}),
					),
				),
			),
		);
		return () => {
			fiber.interruptUnsafe();
		};
	}, [runtime, scope, workspace]);

	const toggle = useCallback(
		(section: SidebarSectionName, expanded: boolean) => {
			setState((current) => ({
				workspace,
				expanded: {
					...(current.workspace === workspace ? current.expanded : {}),
					[section]: expanded,
				},
			}));
			void runtime.runPromise(
				Effect.flatMap(ClientStorage, (storage) =>
					storage.setSidebarSectionExpanded(scope, workspace, section, expanded),
				),
			);
		},
		[runtime, scope, workspace],
	);

	return { toggle, expanded: state.workspace === workspace ? state.expanded : {} };
}
