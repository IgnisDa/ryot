use anyhow::Result;
use common_utils::ryot_log;
use enum_models::MediaLot;
use reqwest::Client;
use reqwest::header::HeaderMap;
use serde_json::json;

pub async fn push_progress(
    api_key: String,
    profile_id: i32,
    tvdb_id: String,
    base_url: String,
    metadata_lot: MediaLot,
    metadata_title: String,
    root_folder_path: String,
    tag_ids: Option<Vec<i32>>,
) -> Result<()> {
    if metadata_lot != MediaLot::Show {
        ryot_log!(debug, "Not a show, skipping {:#?}", metadata_title);
        return Ok(());
    }
    let mut resource = json!({
        "monitored": true,
        "seasonFolder": true,
        "title": metadata_title,
        "qualityProfileId": profile_id,
        "rootFolderPath": root_folder_path,
        "tvdbId": tvdb_id.parse::<i32>().unwrap(),
        "addOptions": {
            "searchForMissingEpisodes": true
        }
    });

    if let Some(tags) = tag_ids {
        resource["tags"] = json!(tags);
    }
    ryot_log!(debug, "Pushing series to Sonarr {:?}", resource);
    let client = Client::new();
    let mut headers = HeaderMap::new();
    headers.insert("X-Api-Key", api_key.parse().unwrap());
    let url = format!("{}/api/v3/series", base_url.trim_end_matches('/'));
    client
        .post(url)
        .headers(headers)
        .json(&resource)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}
