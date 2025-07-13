use anyhow::{Result, bail};
use convert_case::{Case, Casing};
use dependent_models::ImportOrExportMetadataItem;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::MediaSource;
use media_models::ImportOrExportMetadataItemSeen;
use url::Url;

use crate::utils::BrowserExtensionMediaSeen;

fn clean_provider_name(url: &str) -> String {
    let parsed_url = match Url::parse(url) {
        Ok(url) => url,
        Err(_) => return "Unknown".to_string(),
    };

    let host = match parsed_url.host_str() {
        Some(host) => host,
        None => return "Unknown".to_string(),
    };

    let domain = host.strip_prefix("www.").unwrap_or(host);

    let parts: Vec<&str> = domain.split('.').collect();
    if parts.len() >= 2 {
        let name = parts[parts.len() - 2];
        let cleaned = name.replace(['-', '_'], " ");
        return cleaned.to_case(Case::Title);
    }

    "Unknown".to_string()
}

pub async fn sink_progress(
    payload: String,
    disabled_sites: Option<Vec<String>>,
) -> Result<Option<ImportResult>> {
    let payload = match serde_json::from_str::<BrowserExtensionMediaSeen>(&payload) {
        Ok(val) => val,
        Err(err) => bail!(err),
    };

    if let Some(disabled_sites) = disabled_sites {
        for disabled_site in disabled_sites {
            if payload.url.contains(&disabled_site) {
                return Ok(None);
            }
        }
    }

    let media_seen = payload.data;
    let provider_name = clean_provider_name(&payload.url);

    Ok(Some(ImportResult {
        completed: vec![ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot: media_seen.lot,
            source: MediaSource::Tmdb,
            identifier: media_seen.identifier,
            seen_history: vec![ImportOrExportMetadataItemSeen {
                progress: Some(media_seen.progress),
                provider_watched_on: Some(provider_name),
                show_season_number: media_seen.show_season_number,
                show_episode_number: media_seen.show_episode_number,
                ..Default::default()
            }],
            ..Default::default()
        })],
        ..Default::default()
    }))
}
