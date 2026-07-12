import { Effect, Layer, Runtime } from "effect";
import { HttpEffect } from "effect/unstable/http";

import { TransactionRunner } from "./db-service";
import {
	AppConfig as Config,
	CollectionsService as Collections,
	DbService,
	RedisService,
} from "./services";

export const CentralLive = Layer.mergeAll(Config.Default, DbService.Default);
export type HttpApplication = HttpEffect.Default<never>;

export type Handler = (config: Config) => Config;
export type ConfigOverrides = Partial<Config>;
export type ConfigPick = Pick<Config, "frontendUrl">;
export type MembershipResult = ReturnType<Collections["writeMembership"]>;
export type MembershipParameters = Parameters<Collections["writeMembership"]>;
export type ServiceUnion = Config | RedisService;
export type ServiceObject = { readonly redis: RedisService };

export type EffectEnvironment = Effect.Effect<void, never, Config | DbService>;
export type LayerEnvironment = Layer.Layer<Config, never, DbService>;
export type RuntimeEnvironment = Runtime.Runtime<Config | DbService>;

export type EnvironmentAlias =
	| Config["Service"]
	| RedisService
	| Collections["Service"]["writeMembership"]
	| TransactionRunner;
export type EnvironmentAliasProgram = Effect.Effect<void, never, EnvironmentAlias>;
export type OrdinaryImplementationAlias = Config | RedisService;

export type ExistingShape = Config["Service"];
export type ExistingValueShape = typeof Config.Service;

declare const unknownValue: unknown;
export const assertedConfig = unknownValue as Config;
export const satisfiedConfig = unknownValue satisfies Config;
export const configKey = Config;

export function shadowed<Config>() {
	type Shadowed = Config;
	return undefined as unknown as Shadowed;
}
