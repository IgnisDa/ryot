use anyhow::Result;
use enum_models::MediaLot;
use reqwest::{Client, header::HeaderMap};

use crate::utils::{ArrPushConfig, ArrPushConfigExternalId};

pub async fn push_progress(config: ArrPushConfig) -> Result<()> {
    if config.metadata_lot != MediaLot::Show {
        tracing::debug!("Not a show, skipping {:#?}", config.metadata_title);
        return Ok(());
    }
    let tvdb_id = match &config.external_id {
        ArrPushConfigExternalId::Tvdb(id) => id,
        ArrPushConfigExternalId::Tmdb(_) => {
            tracing::debug!("Expected TVDB ID for Sonarr, got TMDB ID");
            return Ok(());
        }
    };
    let mut resource = serde_json::json!({
        "monitored": true,
        "seasonFolder": true,
        "title": config.metadata_title,
        "qualityProfileId": config.profile_id,
        "rootFolderPath": config.root_folder_path,
        "tvdbId": tvdb_id.parse::<i32>().unwrap(),
        "addOptions": { "searchForMissingEpisodes": true }
    });

    if let Some(tags) = config.tag_ids {
        resource["tags"] = serde_json::json!(tags);
    }
    tracing::debug!("Pushing series to Sonarr {:?}", resource);
    let client = Client::new();
    let mut headers = HeaderMap::new();
    headers.insert("X-Api-Key", config.api_key.parse().unwrap());
    let url = format!("{}/api/v3/series", config.base_url.trim_end_matches('/'));
    client
        .post(url)
        .headers(headers)
        .json(&resource)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}
