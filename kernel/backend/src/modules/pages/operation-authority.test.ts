import { expect } from "bun:test";

import type { PageOperationAuthority } from "@ryot-app/contract/modules/pages/identity";
import { UserId } from "@ryot-app/contract/schema/brands";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { PageAuthoringRepository } from "#modules/pages/authoring/repository";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { page } from "#schema/tables/pages";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { PageOperationAuthorization } from "./operation-authority";

const owner = UserId.make("authority-owner");
const foreign = UserId.make("authority-foreign");
const definition = {
	files: [],
	pluginDependencies: {},
	entry: "client/page.tsx",
	queries: { queries: {} },
};
const authority: PageOperationAuthority = {
	revision: 2,
	authorityRevision: 1,
	pageId: "authority-page",
	definitionHash: "published",
};
const database = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(user).values([
				{ id: owner, name: "Owner", email: "owner@authority.test" },
				{ id: foreign, name: "Foreign", email: "foreign@authority.test" },
			]),
		);
		yield* session.run((db) =>
			db
				.insert(page)
				.values({
					userId: owner,
					origin: "user",
					draftRevision: 3,
					slug: "authority",
					name: "Authority",
					writeAccess: true,
					id: authority.pageId,
					draftDefinition: definition,
					draftDefinitionHash: "draft",
					publishedDefinition: definition,
					publishedRevision: authority.revision,
					authorityRevision: authority.authorityRevision,
					publishedDefinitionHash: authority.definitionHash,
				}),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("page_operation_authority")));

layer(database)((test) => {
	test.effect("requires the owner and exact published revision, definition and current grant", () =>
		Effect.gen(function* () {
			const authorization = yield* PageOperationAuthorization.make;
			expect(yield* authorization.current(owner, authority)).toBe(true);
			expect(yield* authorization.current(foreign, authority)).toBe(false);
			for (const changed of [
				{ ...authority, pageId: "missing" },
				{ ...authority, revision: 3 },
				{ ...authority, definitionHash: "draft" },
				{ ...authority, authorityRevision: 0 },
			]) {
				expect(yield* authorization.current(owner, changed)).toBe(false);
			}
			const repository = yield* PageAuthoringRepository.make;
			yield* repository.setWriteAccess(owner, authority.pageId, false);
			expect(yield* authorization.current(owner, authority)).toBe(false);
			yield* repository.setWriteAccess(owner, authority.pageId, true);
			expect(yield* authorization.current(owner, authority)).toBe(false);
			expect(yield* authorization.current(owner, { ...authority, authorityRevision: 3 })).toBe(
				true,
			);
		}),
	);
});
