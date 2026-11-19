import type { PageOperationAuthority } from "@ryot-app/contract/modules/pages/identity";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect } from "effect";

import { PageAuthoringRepository } from "./authoring/repository";

export class PageOperationAuthorization extends Context.Service<PageOperationAuthorization>()(
	"@ryot-app/kernel-backend/modules/pages/operation-authority/PageOperationAuthorization",
	{
		make: Effect.gen(function* () {
			const pages = yield* PageAuthoringRepository.make;
			const current = Effect.fn("PageOperationAuthorization.current")(function* (
				userId: UserId,
				authority: PageOperationAuthority,
				lock = false,
			) {
				const page = yield* lock
					? pages.lock(userId, authority.pageId)
					: pages.find(userId, authority.pageId);
				return (
					page !== null &&
					page.writeAccess &&
					page.publishedDefinition !== null &&
					page.publishedRevision === authority.revision &&
					page.publishedDefinitionHash === authority.definitionHash &&
					page.authorityRevision === authority.authorityRevision
				);
			});
			return { current };
		}),
	},
) {}
