import { Effect, Layer, Runtime } from "effect";
import { HttpEffect } from "effect/unstable/http";

import { TransactionRunner } from "./db-service";
import {
	AppConfig as Config,
	CollectionsService as Collections,
	DbService,
	RedisService,
} from "./services";

export const CentralLive = Layer.mergeAll(Config.layer, DbService.layer);
export type HttpApplication = HttpEffect.Default<never>;

export type Handler = (config: Config["Service"]) => Config["Service"];
export type ConfigOverrides = Partial<Config["Service"]>;
export type ConfigPick = Pick<Config["Service"], "frontendUrl">;
export type MembershipResult = ReturnType<Collections["Service"]["writeMembership"]>;
export type MembershipParameters = Parameters<Collections["Service"]["writeMembership"]>;
export type ServiceUnion = Config["Service"] | RedisService["Service"];
export type ServiceObject = { readonly redis: RedisService["Service"] };

export type EffectEnvironment = Effect.Effect<void, never, Config | DbService>;
export type LayerEnvironment = Layer.Layer<Config, never, DbService>;
export type RuntimeEnvironment = Runtime.Runtime<Config | DbService>;

export type EnvironmentAlias =
	Config | RedisService | Collections["Service"]["writeMembership"] | TransactionRunner;
export type EnvironmentAliasProgram = Effect.Effect<void, never, EnvironmentAlias>;
export type OrdinaryImplementationAlias = Config["Service"] | RedisService["Service"];

export type ExistingShape = Config["Service"];
export type ExistingValueShape = typeof Config.Service;

declare const unknownValue: unknown;
export const assertedConfig = unknownValue as Config["Service"];
export const satisfiedConfig = unknownValue satisfies Config["Service"];
export const configKey = Config;

export function shadowed<Config>() {
	type Shadowed = Config;
	return undefined as unknown as Shadowed;
}
