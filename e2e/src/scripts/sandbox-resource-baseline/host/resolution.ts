import { Schema } from "effect";

import { parseProcCgroup } from "./parsers";
import { ContainerRole, type UnresolvedRole } from "./samples";

export const DEFAULT_SERVICES: Readonly<Record<ContainerRole, string>> = {
	ryot: "ryot",
	postgres: "ryot-db",
	redis: "ryot-redis",
	otel: "otel-collector",
};

export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

export const DockerContainer = Schema.Struct({
	Id: Schema.String,
	Name: Schema.String,
	Image: Schema.String,
	RestartCount: Schema.Int,
	Config: Schema.Struct({ Labels: Schema.NullOr(Schema.Record(Schema.String, Schema.String)) }),
	State: Schema.Struct({
		Pid: Schema.Int,
		Running: Schema.Boolean,
		StartedAt: Schema.String,
		OOMKilled: Schema.Boolean,
	}),
	NetworkSettings: Schema.Struct({
		Networks: Schema.NullOr(
			Schema.Record(Schema.String, Schema.Struct({ IPAddress: Schema.String })),
		),
	}),
});
export type DockerContainer = typeof DockerContainer.Type;

export const decodeDockerInspect = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Array(DockerContainer)),
);

export const DockerImage = Schema.Struct({
	Id: Schema.String,
	RepoDigests: Schema.NullOr(Schema.Array(Schema.String)),
});

export const decodeDockerImageInspect = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Array(DockerImage)),
);

export type RoleAssignment = {
	readonly assigned: ReadonlyArray<{
		readonly role: ContainerRole;
		readonly service: string;
		readonly container: DockerContainer;
	}>;
	readonly unresolved: ReadonlyArray<UnresolvedRole>;
};

/** Roles match only by exact compose service label equality; container names are never consulted. */
export const assignRoles = (
	containers: ReadonlyArray<DockerContainer>,
	services: Readonly<Record<ContainerRole, string>>,
): RoleAssignment => {
	const assigned: Array<RoleAssignment["assigned"][number]> = [];
	const unresolved: Array<UnresolvedRole> = [];
	for (const role of ContainerRole.literals) {
		const service = services[role];
		const matching = containers.filter(
			(container) => container.Config.Labels?.[COMPOSE_SERVICE_LABEL] === service,
		);
		const running = matching.filter((container) => container.State.Running);
		const [only] = running;
		if (running.length === 1 && only !== undefined) {
			assigned.push({ role, service, container: only });
		} else if (running.length > 1) {
			unresolved.push({
				role,
				reason: `ambiguous: ${running.length} running containers for service '${service}'`,
			});
		} else {
			unresolved.push({
				role,
				reason: `no running container for service '${service}' (${matching.length} stopped)`,
			});
		}
	}
	return { assigned, unresolved };
};

export const firstIpAddress = (container: DockerContainer) =>
	Object.values(container.NetworkSettings.Networks ?? {})
		.map(({ IPAddress }) => IPAddress)
		.find((address) => address !== "") ?? null;

export const cgroupCandidates = (containerId: string, procCgroup: string | null) => {
	const fromProc = procCgroup === null ? null : parseProcCgroup(procCgroup);
	return [
		...(fromProc === null ? [] : [`/sys/fs/cgroup${fromProc}`]),
		`/sys/fs/cgroup/system.slice/docker-${containerId}.scope`,
		`/sys/fs/cgroup/docker/${containerId}`,
	];
};
