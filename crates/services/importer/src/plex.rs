use application_utils::get_base_http_client;
use async_graphql::Result;
use common_utils::ryot_log;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use external_models::plex as plex_models;
use importer_models::{ImportFailStep, ImportFailedItem};
use media_models::{
    DeployUrlAndKeyImportInput, ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use reqwest::header::{HeaderName, HeaderValue, ACCEPT};

pub async fn import(input: DeployUrlAndKeyImportInput) -> Result<ImportResult> {
    let client = get_base_http_client(Some(vec![
        (
            HeaderName::from_static("x-plex-token"),
            HeaderValue::from_str(&input.api_key).unwrap(),
        ),
        (ACCEPT, HeaderValue::from_static("application/json")),
    ]));
    let libraries = client
        .get(format!("{}/library/sections", input.api_url))
        .send()
        .await?
        .json::<plex_models::PlexMediaResponse<plex_models::PlexLibrary>>()
        .await?;

    let mut success_items = vec![];
    let mut failed_items = vec![];
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
            .get(format!(
                "{}/library/sections/{}/all",
                input.api_url, dir.key
            ))
            .query(&serde_json::json!({ "includeGuids": "1" }))
            .send()
            .await?
            .json::<plex_models::PlexMediaResponse<plex_models::PlexMetadata>>()
            .await?;
        let total = items.media_container.metadata.len();
        for (idx, item) in items.media_container.metadata.into_iter().enumerate() {
            let Some(_lv) = item.last_viewed_at else {
                continue;
            };
            ryot_log!(debug, "Processing item {}/{}", idx + 1, total);
            let gu_ids = item.guid.unwrap_or_default();
            let Some(tmdb_id) = gu_ids
                .iter()
                .find(|g| g.id.starts_with("tmdb://"))
                .map(|g| &g.id[7..])
            else {
                failed_items.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: format!("{} ({}) - {}", item.title, lot, item.key),
                    error: Some("No TMDb ID associated with this media".to_string()),
                });
                continue;
            };
            match lot {
                MediaLot::Movie => {
                    success_items.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                        lot,
                        source_id: item.key,
                        source: MediaSource::Tmdb,
                        identifier: tmdb_id.to_string(),
                        seen_history: vec![ImportOrExportMetadataItemSeen {
                            ended_on: item.last_viewed_at.map(|d| d.date_naive()),
                            provider_watched_on: Some(ImportSource::Plex.to_string()),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }));
                }
                MediaLot::Show => {
                    let leaves = client
                        .get(format!(
                            "{}/library/metadata/{}/allLeaves",
                            input.api_url,
                            item.rating_key.unwrap()
                        ))
                        .send()
                        .await?
                        .json::<plex_models::PlexMediaResponse<plex_models::PlexMetadata>>()
                        .await?;
                    let mut item = ImportOrExportMetadataItem {
                        lot,
                        source: MediaSource::Tmdb,
                        source_id: item.key.clone(),
                        identifier: tmdb_id.to_string(),
                        ..Default::default()
                    };
                    for leaf in leaves.media_container.metadata {
                        if leaf.last_viewed_at.is_some() {
                            item.seen_history.push(ImportOrExportMetadataItemSeen {
                                show_episode_number: leaf.index,
                                show_season_number: leaf.parent_index,
                                ended_on: leaf.last_viewed_at.map(|d| d.date_naive()),
                                provider_watched_on: Some(ImportSource::Plex.to_string()),
                                ..Default::default()
                            });
                        }
                    }
                    success_items.push(ImportCompletedItem::Metadata(item));
                }
                _ => unreachable!(),
            }
        }
    }

    Ok(ImportResult {
        completed: success_items,
        failed: failed_items,
    })
}
