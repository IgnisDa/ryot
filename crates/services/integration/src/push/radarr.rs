use anyhow::Result;
use enum_models::MediaLot;
use reqwest::{Client, header::HeaderMap};

use crate::utils::{ArrPushConfig, ArrPushConfigExternalId};

pub async fn push_progress(config: ArrPushConfig) -> Result<()> {
    if config.metadata_lot != MediaLot::Movie {
        tracing::debug!("Not a movie, skipping {:#?}", config.metadata_title);
        return Ok(());
    }
    let tmdb_id = match &config.external_id {
        ArrPushConfigExternalId::Tmdb(id) => id,
        ArrPushConfigExternalId::Tvdb(_) => {
            tracing::debug!("Expected TMDB ID for Radarr, got TVDB ID");
            return Ok(());
        }
    };
    let mut resource = serde_json::json!({
        "title": config.metadata_title,
        "tmdbId": tmdb_id.parse::<i32>().unwrap(),
        "qualityProfileId": config.profile_id,
        "rootFolderPath": config.root_folder_path,
        "monitored": true,
        "addOptions": { "searchForMovie": true }
    });

    if let Some(tags) = config.tag_ids {
        resource["tags"] = serde_json::json!(tags);
    }
    tracing::debug!("Pushing movie to Radarr {:?}", resource);
    let client = Client::new();
    let mut headers = HeaderMap::new();
    headers.insert("X-Api-Key", config.api_key.parse().unwrap());
    let url = format!("{}/api/v3/movie", config.base_url.trim_end_matches('/'));
    client
        .post(url)
        .headers(headers)
        .json(&resource)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}
