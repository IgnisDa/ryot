import { parseArgs } from "node:util";

import { DEFAULT_SERVICES } from "./resolution";
import { ContainerRole } from "./samples";

export const USAGE = `Usage: ryot-benchmark-host <command> [options]

  sample   --project <compose-project> --output <jsonl-file> [--interval-ms 1000]
           [--device <name>] [--pid-file <file>] [--service <role>=<service>]...
  metadata --project <compose-project> [--device <name>] [--service <role>=<service>]...
  app-sample --project <compose-project> --output <jsonl-file> --token-file <file>
           [--interval-ms 200] [--aux-interval-ms 1000] [--port 8000] [--pid-file <file>]
  journal  --since <iso> --until <iso>
  watchdog --project <compose-project> --trigger-file <jsonl-file> [--dry-run] [--drill]
           [--pid-file <file>] [--health-url-path /api/system/health] [--health-port 8000]
           [--service <role>=<service>]...

Roles: ryot, postgres, redis, otel (default services: ryot, ryot-db, ryot-redis, otel-collector).
Signals for sample: SIGUSR1 resets the Ryot memory.peak; SIGTERM/SIGINT exit after the current line.`;

type Services = Readonly<Record<ContainerRole, string>>;

export type Command =
	| { readonly kind: "help" }
	| {
			readonly kind: "sample";
			readonly project: string;
			readonly output: string;
			readonly intervalMs: number;
			readonly device: string | null;
			readonly pidFile: string | null;
			readonly services: Services;
	  }
	| {
			readonly kind: "metadata";
			readonly project: string;
			readonly device: string | null;
			readonly services: Services;
	  }
	| {
			readonly kind: "app-sample";
			readonly project: string;
			readonly output: string;
			readonly tokenFile: string;
			readonly intervalMs: number;
			readonly auxIntervalMs: number;
			readonly port: number;
			readonly pidFile: string | null;
			readonly services: Services;
	  }
	| { readonly kind: "journal"; readonly since: string; readonly until: string }
	| {
			readonly kind: "watchdog";
			readonly project: string;
			readonly triggerFile: string;
			readonly dryRun: boolean;
			readonly drill: boolean;
			readonly pidFile: string | null;
			readonly healthPath: string;
			readonly healthPort: number;
			readonly services: Services;
	  };

const isRole = (value: string): value is ContainerRole =>
	ContainerRole.literals.some((role) => role === value);

export const parseServices = (overrides: ReadonlyArray<string>): Services => {
	const services: Record<ContainerRole, string> = { ...DEFAULT_SERVICES };
	for (const override of overrides) {
		const separator = override.indexOf("=");
		const role = override.slice(0, separator);
		const service = override.slice(separator + 1);
		if (separator <= 0 || service === "" || !isRole(role)) {
			throw new Error(`invalid --service '${override}'; expected <role>=<service>`);
		}
		services[role] = service;
	}
	return services;
};

const positiveInteger = (value: string | undefined, fallback: number, flag: string) => {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer`);
	}
	return parsed;
};

export const parseCommand = (argv: ReadonlyArray<string>): Command => {
	const [name, ...rest] = argv;
	const { values } = parseArgs({
		args: rest,
		strict: true,
		options: {
			port: { type: "string" },
			help: { type: "boolean" },
			since: { type: "string" },
			until: { type: "string" },
			output: { type: "string" },
			device: { type: "string" },
			drill: { type: "boolean" },
			project: { type: "string" },
			"pid-file": { type: "string" },
			"dry-run": { type: "boolean" },
			"token-file": { type: "string" },
			"interval-ms": { type: "string" },
			"health-port": { type: "string" },
			"trigger-file": { type: "string" },
			"aux-interval-ms": { type: "string" },
			"health-url-path": { type: "string" },
			service: { type: "string", multiple: true },
		},
	});
	const required = (flag: keyof typeof values) => {
		const value = values[flag];
		if (typeof value !== "string" || value === "") {
			throw new Error(`${name ?? ""} requires --${flag}`);
		}
		return value;
	};
	if (name === undefined || name === "help" || name === "--help" || values.help === true) {
		return { kind: "help" };
	}
	const services = parseServices(values.service ?? []);
	switch (name) {
		case "sample":
			return {
				services,
				kind: "sample",
				output: required("output"),
				project: required("project"),
				device: values.device ?? null,
				pidFile: values["pid-file"] ?? null,
				intervalMs: positiveInteger(values["interval-ms"], 1_000, "--interval-ms"),
			};
		case "metadata":
			return {
				services,
				kind: "metadata",
				project: required("project"),
				device: values.device ?? null,
			};
		case "app-sample":
			return {
				services,
				kind: "app-sample",
				output: required("output"),
				project: required("project"),
				tokenFile: required("token-file"),
				pidFile: values["pid-file"] ?? null,
				port: positiveInteger(values.port, 8_000, "--port"),
				intervalMs: positiveInteger(values["interval-ms"], 200, "--interval-ms"),
				auxIntervalMs: positiveInteger(values["aux-interval-ms"], 1_000, "--aux-interval-ms"),
			};
		case "journal":
			return { kind: "journal", since: required("since"), until: required("until") };
		case "watchdog":
			return {
				services,
				kind: "watchdog",
				project: required("project"),
				drill: values.drill === true,
				pidFile: values["pid-file"] ?? null,
				triggerFile: required("trigger-file"),
				dryRun: values["dry-run"] === true || values.drill === true,
				healthPath: values["health-url-path"] ?? "/api/system/health",
				healthPort: positiveInteger(values["health-port"], 8_000, "--health-port"),
			};
		default:
			throw new Error(`unknown command '${name}'`);
	}
};
