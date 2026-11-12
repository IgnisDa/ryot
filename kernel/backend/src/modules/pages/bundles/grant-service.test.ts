import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { ReusableCapabilityGrantStore } from "#modules/pages/bundles/reusable-capability-grants";
import { TransientValues } from "#platform/transient-values";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { ClientArtifactGrantAuthority } from "./grant-authority";
import { ClientArtifactGrantService } from "./grant-service";

const grantServiceLayer = ClientArtifactGrantService.layer.pipe(
	Layer.provide(ReusableCapabilityGrantStore.layer),
	Layer.provide(ClientArtifactGrantAuthority.denied),
	Layer.provideMerge(TransientValues.layer),
	Layer.provideMerge(isolatedDatabaseLayer("artifact_grants")),
);

layer(grantServiceLayer)((test) => {
	test.effect(
		"reuses grants only for the same user and artifact and rejects expired or malformed tokens",
		() => {
			const user = UserId.make("user-1");
			const other = UserId.make("user-2");
			return Effect.gen(function* () {
				const grants = yield* ClientArtifactGrantService;
				const first = yield* grants.issue(user, "artifact-A");
				expect((yield* grants.issue(user, "artifact-A")).token).toBe(first.token);
				expect((yield* grants.issue(other, "artifact-A")).token).not.toBe(first.token);
				expect((yield* grants.issue(user, "artifact-B")).token).not.toBe(first.token);
				expect(yield* grants.resolve(first.token)).toEqual({
					userId: user,
					artifactHash: "artifact-A",
				});
				expect(yield* grants.resolve("bad")).toBeNull();
				yield* (yield* TransientValues).remove(`ryot:client-artifacts:grant:${first.grantId}`);
				expect(yield* grants.resolve(first.token)).toBeNull();
				expect((yield* grants.issue(user, "artifact-A")).token).not.toBe(first.token);
			});
		},
		testTimeout,
	);
});
