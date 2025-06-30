use anyhow::Result;
use application_utils::get_base_http_client;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use dependent_models::ImportOrExportMetadataItem;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use external_models::plex as plex_models;
use reqwest::header::{ACCEPT, HeaderName, HeaderValue};

pub async fn sync_to_owned_collection(base_url: String, token: String) -> Result<ImportResult> {
    let client = get_base_http_client(Some(vec![
        (
            HeaderName::from_static("x-plex-token"),
            HeaderValue::from_str(&token).unwrap(),
        ),
        (ACCEPT, HeaderValue::from_static("application/json")),
    ]));
    let libraries = client
        .get(format!("{}/library/sections", base_url))
        .send()
        .await?
        .json::<plex_models::PlexMediaResponse<plex_models::PlexLibrary>>()
        .await?;

    let mut success_items = vec![];
    for dir in libraries.media_container.directory {
        ryot_log!(debug, "Processing directory {:?}", dir.title);
        let item_type = dir.item_type.as_str();
        if !["movie", "show"].contains(&item_type) {
            ryot_log!(debug, "Skipping directory {:?}", dir.title);
            continue;
        }
        let lot = match item_type {
            "movie" => MediaLot::Movie,
            "show" => MediaLot::Show,
            _ => unreachable!(),
        };
        let items = client
            .get(format!("{}/library/sections/{}/all", base_url, dir.key))
            .query(&serde_json::json!({ "includeGuids": "1" }))
            .send()
            .await?
            .json::<plex_models::PlexMediaResponse<plex_models::PlexMetadata>>()
            .await?;
        let Some(metadata) = items.media_container.metadata else {
            continue;
        };
        for (idx, item) in metadata.into_iter().enumerate() {
            ryot_log!(debug, "Processing item {}", idx + 1);
            let gu_ids = item.guid.unwrap_or_default();
            let Some(tmdb_id) = gu_ids
                .iter()
                .find(|g| g.id.starts_with("tmdb://"))
                .map(|g| &g.id[7..])
            else {
                continue;
            };
            success_items.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot,
                source_id: item.key,
                source: MediaSource::Tmdb,
                identifier: tmdb_id.to_string(),
                collections: vec![DefaultCollection::Owned.to_string()],
                ..Default::default()
            }));
        }
    }
    Ok(ImportResult {
        completed: success_items,
        ..Default::default()
    })
}
