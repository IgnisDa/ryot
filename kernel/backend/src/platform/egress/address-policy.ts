import { Option, Result } from "effect";
import { IpNetwork, NetAddress } from "effect/net";

const networks = (...cidrs: ReadonlyArray<string>) => cidrs.map(IpNetwork.fromStringUnsafe);

const HARD_BLOCKED = networks(
	"0.0.0.0/8",
	"169.254.0.0/16",
	"100.100.100.200/32",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"::/128",
	"fe80::/10",
	"ff00::/8",
	"fd00:ec2::254/128",
	"64:ff9b:1::/48",
	"2002::/16",
	"2001::/32",
);

const DENIED_UNLESS_ALLOWED = networks(
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.31.196.0/24",
	"192.52.193.0/24",
	"192.88.99.0/24",
	"192.168.0.0/16",
	"192.175.48.0/24",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"::1/128",
	"100::/64",
	"100:0:0:1::/64",
	"2001::/23",
	"2001:db8::/32",
	"2620:4f:8000::/48",
	"3fff::/20",
	"5f00::/16",
	"fc00::/7",
);

const IPV4_EMBEDDING = networks("::/96", "64:ff9b::/96");

// `::` and `::1` sit inside the IPv4-compatible range but are IPv6 addresses in their own right.
const canonicalAddress = (address: NetAddress.IpAddress): NetAddress.IpAddress => {
	if (NetAddress.isIpv4Address(address)) {
		return address;
	}
	if (NetAddress.isIpv4Mapped(address)) {
		return NetAddress.toCanonical(address);
	}
	if (
		NetAddress.isUnspecified(address) ||
		NetAddress.isLoopback(address) ||
		!IPV4_EMBEDDING.some((network) => IpNetwork.contains(network, address))
	) {
		return address;
	}
	const [, , , , , , high, low] = NetAddress.ipv6ToSegments(address);
	return Result.getOrElse(
		NetAddress.ipv4FromOctets([high >>> 8, high & 0xff, low >>> 8, low & 0xff]),
		() => address,
	);
};

export const classifyAddress = (
	ip: string,
	allowedNetworks: ReadonlyArray<IpNetwork.IpNetwork>,
): "allowed" | "denied" =>
	Option.match(Option.map(Result.getSuccess(NetAddress.ipFromString(ip)), canonicalAddress), {
		onNone: () => "denied",
		onSome: (address) => {
			const within = (network: IpNetwork.IpNetwork) => IpNetwork.contains(network, address);
			return HARD_BLOCKED.some(within) ||
				(DENIED_UNLESS_ALLOWED.some(within) && !allowedNetworks.some(within))
				? "denied"
				: "allowed";
		},
	});

export const parseEgressAllowedNetworks = (
	value: string,
): Result.Result<ReadonlyArray<IpNetwork.IpNetwork>, string> => {
	const parsed: Array<IpNetwork.IpNetwork> = [];
	for (const entry of value.split(",").map((part) => part.trim())) {
		if (entry === "") {
			continue;
		}
		const network = IpNetwork.fromString(entry);
		if (Result.isFailure(network)) {
			return Result.fail(`'${entry}' is not a CIDR network`);
		}
		if (HARD_BLOCKED.some((blocked) => IpNetwork.containsNetwork(blocked, network.success))) {
			return Result.fail(`'${entry}' is inside a range that cannot be allowed`);
		}
		parsed.push(network.success);
	}
	return Result.succeed(parsed);
};
