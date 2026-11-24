use std::{
    io,
    net::{IpAddr, Ipv6Addr},
    sync::Arc,
};

use anyhow::{Result, anyhow, bail, ensure};
use reqwest::{
    Client, RequestBuilder, Url,
    dns::{Addrs, Name, Resolve, Resolving},
    redirect::Policy,
};
use tokio::net::lookup_host;
use url::Host;

const BLOCKED_ADDRESS: &str = "Notification destination address is blocked by server policy";

#[derive(Clone, Copy)]
enum DestinationPolicy {
    PublicHttps,
    PrivateHttp,
    PublicOrPrivateHttps,
}

enum Network {
    Public,
    Private,
    Reserved,
}

pub(super) fn post(destination: &str, allow_private_networks: bool) -> Result<RequestBuilder> {
    let url = Url::parse(destination).map_err(|_| anyhow!("Invalid notification URL"))?;
    let policy = match (url.scheme(), allow_private_networks) {
        ("https", false) => DestinationPolicy::PublicHttps,
        ("http", true) => DestinationPolicy::PrivateHttp,
        ("https", true) => DestinationPolicy::PublicOrPrivateHttps,
        _ => bail!("Notification URLs must use HTTPS unless private-network HTTP is enabled"),
    };

    match url.host() {
        Some(Host::Domain(_)) => {}
        Some(Host::Ipv4(ip)) => ensure!(policy.allows(ip.into()), BLOCKED_ADDRESS),
        Some(Host::Ipv6(ip)) => ensure!(policy.allows(ip.into()), BLOCKED_ADDRESS),
        None => bail!("Notification URL is missing a host"),
    }

    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .dns_resolver(Arc::new(policy))
        .build()?;
    Ok(client.post(url))
}

impl DestinationPolicy {
    fn allows(self, ip: IpAddr) -> bool {
        matches!(
            (self, network_for(ip)),
            (Self::PublicHttps, Network::Public)
                | (Self::PrivateHttp, Network::Private)
                | (
                    Self::PublicOrPrivateHttps,
                    Network::Public | Network::Private
                )
        )
    }
}

impl Resolve for DestinationPolicy {
    fn resolve(&self, name: Name) -> Resolving {
        let policy = *self;
        Box::pin(async move {
            let addresses: Vec<_> = lookup_host((name.as_str(), 0))
                .await?
                .filter(|address| policy.allows(address.ip()))
                .collect();
            if addresses.is_empty() {
                return Err(io::Error::other(BLOCKED_ADDRESS).into());
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

fn network_for(ip: IpAddr) -> Network {
    match ip.to_canonical() {
        IpAddr::V4(ip) => match ip.octets() {
            [0 | 127 | 224..=255, ..]
            | [169, 254, ..]
            | [192, 0, 0 | 2, _]
            | [192, 88, 99, _]
            | [198, 18 | 19, ..]
            | [198, 51, 100, _]
            | [203, 0, 113, _] => Network::Reserved,
            [100, 64..=127, ..] => Network::Private,
            _ if ip.is_private() => Network::Private,
            _ => Network::Public,
        },
        IpAddr::V6(ip) => {
            const EC2_METADATA_ADDRESS: Ipv6Addr =
                Ipv6Addr::new(0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254);
            match ip.segments() {
                _ if ip == EC2_METADATA_ADDRESS => Network::Reserved,
                _ if ip.is_unique_local() => Network::Private,
                [0x2001, 0..=0x1ff | 0xdb8, ..] | [0x2002, ..] | [0x3fff, 0..=0xfff, ..] => {
                    Network::Reserved
                }
                [0x2000..=0x3fff, ..] => Network::Public,
                _ => Network::Reserved,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_http_requires_opt_in_and_public_http_stays_blocked() {
        assert!(post("https://1.1.1.1", false).is_ok());
        assert!(post("http://1.1.1.1", true).is_err());
        assert!(post("http://192.168.1.10", false).is_err());
        assert!(post("https://192.168.1.10", false).is_err());
        assert!(post("http://192.168.1.10", true).is_ok());
        assert!(post("https://[fd00::1]", true).is_ok());
    }

    #[test]
    fn opt_in_still_blocks_loopback_link_local_and_reserved_addresses() {
        for addr in [
            "0.0.0.0",
            "127.0.0.1",
            "[::1]",
            "[::ffff:127.0.0.1]",
            "169.254.1.1",
            "[fe80::1]",
            "[fd00:ec2::254]",
            "192.0.2.1",
            "[2001:db8::1]",
        ] {
            assert!(post(&format!("https://{addr}"), true).is_err(), "{addr}");
        }
    }

    #[tokio::test]
    async fn dns_answers_are_checked_before_connecting() {
        let name = "localhost".parse().unwrap();
        assert!(
            DestinationPolicy::PublicOrPrivateHttps
                .resolve(name)
                .await
                .is_err()
        );
    }
}
