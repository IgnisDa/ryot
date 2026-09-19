import { Context, Effect, Layer, Ref } from "effect";
import type { InlineConfig } from "vite";

import type { ViteCompilerError } from "./error";
import { ViteBuildService } from "./vite";

type ViteBuildResponse = (config: InlineConfig) => Effect.Effect<unknown, ViteCompilerError>;

export class FakeViteBuild extends Context.Service<
	FakeViteBuild,
	{
		readonly builds: Effect.Effect<ReadonlyArray<InlineConfig>>;
		readonly respondWith: (respond: ViteBuildResponse) => Effect.Effect<void>;
	}
>()("test/FakeViteBuild") {}

export const fakeViteBuildLayer = (respond: ViteBuildResponse) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const builds = yield* Ref.make<ReadonlyArray<InlineConfig>>([]);
			const response = yield* Ref.make(respond);
			return Context.make(
				ViteBuildService,
				ViteBuildService.of({
					build: (config) =>
						Ref.update(builds, (all) => [...all, config]).pipe(
							Effect.andThen(Ref.get(response)),
							Effect.flatMap((current) => current(config)),
						),
				}),
			).pipe(
				Context.add(FakeViteBuild, {
					builds: Ref.get(builds),
					respondWith: (next) => Ref.set(response, next),
				}),
			);
		}),
	);
