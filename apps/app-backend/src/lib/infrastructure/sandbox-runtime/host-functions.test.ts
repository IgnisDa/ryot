import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { EntityId, EventSchemaId, UserId } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Either, Layer, Option, Redacted } from "effect";
import { describe } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowEngine,
} from "#lib/test-support/effect";
import { AutomationsRepository } from "#modules/automations/repository";
import { AutomationsService } from "#modules/automations/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { QueryEngineService } from "#modules/query-engine/service";

import { getSandboxAppConfigValue } from "./app-config";
import { makeAdditionalSandboxApiFunctions } from "./host-functions";
import type { UserSandboxRunInput } from "./shared";

const config = {
	port: 8000,
	nodeEnv: "test",
	providers: {
		googleBooksApiKey: Option.none(),
		malClientId: Option.some("mal-client"),
		giantBombApiKey: Option.some(Redacted.make("giant-secret")),
	},
};

const runEither = (key: string, scriptIsBuiltin: boolean) =>
	Effect.either(getSandboxAppConfigValue(config, key, scriptIsBuiltin));

describe("getSandboxAppConfigValue", () => {
	it.effect("reads non-sensitive app config values", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.malClientId", false);

			expect(Either.getOrThrow(result)).toBe("mal-client");
		}),
	);

	it.effect("rejects host environment keys", () =>
		Effect.gen(function* () {
			const result = yield* runEither("PATH", false);

			expect(Either.getLeft(result)).toEqual(Option.some('Config key "PATH" does not exist'));
		}),
	);

	it.effect("rejects sensitive config values for user scripts", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.giantBombApiKey", false);

			expect(Either.getLeft(result)).toEqual(
				Option.some('Config key "providers.giantBombApiKey" is sensitive'),
			);
		}),
	);

	it.effect("allows sensitive config values for builtin scripts", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.giantBombApiKey", true);

			expect(Either.getOrThrow(result)).toBe("giant-secret");
		}),
	);

	it.effect("rejects unconfigured optional values", () =>
		Effect.gen(function* () {
			const result = yield* runEither("providers.googleBooksApiKey", true);

			expect(Either.getLeft(result)).toEqual(
				Option.some('Config key "providers.googleBooksApiKey" is not configured'),
			);
		}),
	);
});

type ObservedCreate = {
	readonly source: string;
	readonly metadata?: unknown;
	readonly executionId?: string;
	readonly payload: ReadonlyArray<unknown>;
};

const hashPayload = (payload: unknown) =>
	new Bun.CryptoHasher("sha256").update(stableStringify(payload)).digest("base64url");

const directRunInput: UserSandboxRunInput = {
	code: "",
	context: {},
	metadata: null,
	scriptIsBuiltin: false,
	driverName: "detector",
	executionKind: "direct",
	executionId: "run-exec-1",
	scriptId: "sandbox-script-1",
	userId: UserId.make("user-id"),
	allowedHostFunctions: ["createEvents"],
};

const createEventsBody = [
	{
		properties: {},
		occurredAt: "2026-01-01T00:00:00.000Z",
		entityId: EntityId.make("entity-1"),
		eventSchemaId: EventSchemaId.make("event-schema-1"),
	},
];

describe("createEvents direct sandbox semantics", () => {
	it.effect("dispatches a depth-zero root event without touching the effect ledger", () => {
		const createInputs: ObservedCreate[] = [];
		let reserveEffectCalls = 0;
		const layer = Layer.mergeAll(
			dbRunnerLayer,
			makeAppConfigLayer(),
			Layer.succeed(RedisService, makeRedisService()),
			Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
			Layer.mock(AutomationsRepository, { _tag: "AutomationsRepository" }),
			Layer.mock(EntitiesRepository, { _tag: "EntitiesRepository" }),
			Layer.mock(QueryEngineService, { _tag: "QueryEngineService" }),
			Layer.mock(IntegrationsRepository, { _tag: "IntegrationsRepository" }),
			Layer.mock(EventSchemasRepository, { _tag: "EventSchemasRepository" }),
			Layer.mock(EntitySchemasRepository, { _tag: "EntitySchemasRepository" }),
			Layer.mock(AutomationsService, {
				_tag: "AutomationsService",
				reserveEffect: () => {
					reserveEffectCalls += 1;
					return Effect.die("reserveEffect must not be called for direct createEvents");
				},
			}),
			Layer.mock(EventsService, {
				_tag: "EventsService",
				create: (input) => {
					createInputs.push(input);
					return Effect.succeed({ count: 1, skipped: 0 });
				},
			}),
		);

		return Effect.gen(function* () {
			const functions = yield* makeAdditionalSandboxApiFunctions();
			const createEvents = functions["createEvents"];
			if (!createEvents) {
				throw new Error("createEvents host function missing");
			}
			const result = yield* Effect.promise(() => createEvents(createEventsBody, directRunInput));

			expect(result).toEqual({ success: true, data: { count: 1, skipped: 0 } });
			expect(reserveEffectCalls).toBe(0);
			expect(createInputs).toHaveLength(1);

			const created = createInputs[0];
			if (!created) {
				throw new Error("createEvents did not invoke EventsService.create");
			}
			expect(created.source).toBe("sandbox");
			expect(created.metadata).toBeUndefined();
			expect(created.executionId).toBe(
				`${directRunInput.executionId}-create-events-${hashPayload(created.payload)}`,
			);
		}).pipe(Effect.provide(layer));
	});
});
