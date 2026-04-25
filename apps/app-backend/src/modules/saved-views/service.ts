import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateSavedViewBody,
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginSlug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { DefinitionRegistry } from "#modules/definition-registry/service";

import { validateSavedViewDefinition } from "./definition-validation";
import { SavedViewsRepository } from "./repository";

const savedViewNotFound = "Saved view not found";
const builtinViewMutationMessage = "Cannot modify built-in saved views";

/** @effect-expect-leaking Database */
export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.gen(function* () {
		const definitions = yield* DefinitionRegistry;
		const repository = yield* SavedViewsRepository;

		const list = Effect.fn(function* (
			user: CurrentUserValue,
			input: { pluginSlug?: PluginSlug | undefined; includeDisabled: boolean },
		) {
			return yield* repository.listByUser(user.id, input);
		});

		const ensureBuiltinViews = Effect.fn(function* (userId: CurrentUserValue["id"]) {
			const views = Object.values(definitions.getSnapshot().savedViews);
			yield* repository.ensureBuiltinViews(
				userId,
				views.map(({ slug, name, icon, layouts, sortOrder, pluginSlug, entitySchemaSlug }) => ({
					slug,
					name,
					icon,
					layouts,
					sortOrder,
					pluginSlug: pluginSlug ? PluginSlug.make(pluginSlug) : null,
					entitySchemaSlug:
						entitySchemaSlug === null ? null : EntitySchemaSlug.make(entitySchemaSlug),
				})),
			);
		});

		const requireSavedView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const savedView = yield* repository.findBySlug(user.id, viewSlug);
			if (savedView) {
				return savedView;
			}
			return yield* notFound(savedViewNotFound);
		});

		const create = Effect.fn(function* (
			user: Pick<CurrentUserValue, "id">,
			payload: CreateSavedViewBody & { slug?: string | undefined },
		) {
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* badRequest("Saved view name is required");
			}
			const slug = slugify(payload.slug ?? name);
			if (!slug) {
				return yield* badRequest("Saved view slug is required");
			}
			if (definitions.getSavedView(slug) || (yield* repository.findBySlug(user.id, slug))) {
				return yield* badRequest("A saved view with this name already exists");
			}
			yield* validateSavedViewDefinition(payload);
			if (
				payload.entitySchemaSlug !== null &&
				!definitions.getEntitySchema(payload.entitySchemaSlug)
			) {
				return yield* badRequest("Entity schema not found");
			}
			const created = yield* repository.create(user.id, {
				slug,
				name,
				userId: user.id,
				icon: payload.icon,
				layouts: payload.layouts,
				pluginSlug: payload.pluginSlug,
				entitySchemaSlug: payload.entitySchemaSlug,
			});
			return created ?? (yield* badRequest("A saved view with this name already exists"));
		});

		const update = Effect.fn(function* (
			user: CurrentUserValue,
			viewSlug: string,
			payload: UpdateSavedViewBody & { sortOrder?: number | undefined },
		) {
			const current = yield* requireSavedView(user, viewSlug);
			const layouts = payload.layouts ?? current.layouts;
			const entitySchemaSlug = payload.entitySchemaSlug ?? current.entitySchemaSlug;
			if (current.isBuiltin) {
				if (
					payload.name !== current.name ||
					payload.icon !== current.icon ||
					(payload.pluginSlug ?? null) !== current.pluginSlug ||
					(payload.entitySchemaSlug !== undefined &&
						payload.entitySchemaSlug !== current.entitySchemaSlug) ||
					(payload.layouts !== undefined && !Bun.deepEquals(payload.layouts, current.layouts))
				) {
					return yield* badRequest(builtinViewMutationMessage);
				}
				return (
					(yield* repository.updateBuiltinStateBySlug(
						user.id,
						viewSlug,
						payload.isDisabled,
						payload.sortOrder ?? current.sortOrder,
					)) ?? (yield* notFound(savedViewNotFound))
				);
			}
			const name = trimToNull(payload.name);
			if (!name) {
				return yield* badRequest("Saved view name is required");
			}
			yield* validateSavedViewDefinition({ layouts });
			if (entitySchemaSlug !== null && !definitions.getEntitySchema(entitySchemaSlug)) {
				return yield* badRequest("Entity schema not found");
			}
			const updated = yield* repository.updateBySlug(
				user.id,
				viewSlug,
				{ ...payload, layouts, name, entitySchemaSlug, sortOrder: payload.sortOrder },
				current.pluginSlug,
			);
			return updated ?? (yield* notFound(savedViewNotFound));
		});

		const deleteView = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const current = yield* requireSavedView(user, viewSlug);
			if (current.isBuiltin) {
				return yield* badRequest(builtinViewMutationMessage);
			}
			return (
				(yield* repository.deleteBySlug(user.id, viewSlug)) ?? (yield* notFound(savedViewNotFound))
			);
		});

		const clone = Effect.fn(function* (user: CurrentUserValue, viewSlug: string) {
			const source = yield* requireSavedView(user, viewSlug);
			return yield* create(user, {
				icon: source.icon,
				layouts: source.layouts,
				name: `${source.name} (Copy)`,
				entitySchemaSlug: source.entitySchemaSlug,
				...(source.pluginSlug ? { pluginSlug: source.pluginSlug } : {}),
			});
		});

		const reorder = Effect.fn(function* (user: CurrentUserValue, payload: ReorderSavedViewsBody) {
			const views = yield* list(user, { pluginSlug: payload.pluginSlug, includeDisabled: true });
			const scoped = views.filter(
				(view) => (view.pluginSlug ?? null) === (payload.pluginSlug ?? null),
			);
			const requested = payload.viewSlugs.map((slug) => slug.trim()).filter(Boolean);
			if (requested.length === 0 || new Set(requested).size !== requested.length) {
				return yield* badRequest("View slugs are required and must be unique");
			}
			if (requested.some((slug) => !scoped.some((view) => view.slug === slug))) {
				return yield* badRequest("Saved view slugs contain unknown saved views");
			}
			const reordered = [
				...requested,
				...scoped.map((view) => view.slug).filter((slug) => !requested.includes(slug)),
			];
			for (const [sortOrder, slug] of reordered.entries()) {
				const view = scoped.find((item) => item.slug === slug);
				if (!view) {
					continue;
				}
				yield* update(user, slug, {
					...view,
					sortOrder,
					pluginSlug: view.pluginSlug ?? undefined,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));
			}
			return { viewSlugs: reordered };
		});

		return {
			clone,
			create,
			update,
			reorder,
			delete: deleteView,
			ensureBuiltinViews,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
