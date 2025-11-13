use std::result::Result as StdResult;

use anyhow::Result;
use common_utils::get_base_http_client;
use common_utils::ryot_log;
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use external_models::plex as plex_models;
use futures::stream::{self, StreamExt};
use importer_models::{ImportFailStep, ImportFailedItem};
use media_models::{DeployUrlAndKeyImportInput, ImportOrExportMetadataItemSeen};
use reqwest::{
    Client,
    header::{ACCEPT, HeaderName, HeaderValue},
};

async fn process_metadata_item(
    idx: usize,
    item: plex_models::PlexMetadataItem,
    total: usize,
    lot: MediaLot,
    client: &Client,
    api_url: &str,
) -> StdResult<ImportCompletedItem, ImportFailedItem> {
    let Some(_lv) = item.last_viewed_at else {
        return Err(ImportFailedItem {
            lot: Some(lot),
            step: ImportFailStep::InputTransformation,
            identifier: format!("{} ({}) - {}", item.title, lot, item.key),
            error: Some("No last viewed date".to_string()),
        });
    };
    ryot_log!(debug, "Processing item {}/{}", idx + 1, total);
    let gu_ids = item.guid.unwrap_or_default();
    let Some(tmdb_id) = gu_ids
        .iter()
        .find(|g| g.id.starts_with("tmdb://"))
        .map(|g| &g.id[7..])
    else {
        return Err(ImportFailedItem {
            lot: Some(lot),
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: format!("{} ({}) - {}", item.title, lot, item.key),
            error: Some("No TMDb ID associated with this media".to_string()),
        });
    };

    let result = match lot {
        MediaLot::Movie => ImportOrExportMetadataItem {
            lot,
            source_id: item.key,
            source: MediaSource::Tmdb,
            identifier: tmdb_id.to_string(),
            seen_history: vec![ImportOrExportMetadataItemSeen {
                ended_on: item.last_viewed_at,
                providers_consumed_on: Some(vec![ImportSource::Plex.to_string()]),
                ..Default::default()
            }],
            ..Default::default()
        },
        MediaLot::Show => {
            let leaves = client
                .get(format!(
                    "{}/library/metadata/{}/allLeaves",
                    api_url,
                    item.rating_key.unwrap()
                ))
                .send()
                .await
                .map_err(|e| ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: format!("{} ({}) - {}", item.title, lot, item.key),
                    error: Some(e.to_string()),
                })?
                .json::<plex_models::PlexMediaResponse<plex_models::PlexMetadata>>()
                .await
                .map_err(|e| ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: format!("{} ({}) - {}", item.title, lot, item.key),
                    error: Some(e.to_string()),
                })?;
            let mut result_item = ImportOrExportMetadataItem {
                lot,
                source: MediaSource::Tmdb,
                source_id: item.key.clone(),
                identifier: tmdb_id.to_string(),
                ..Default::default()
            };
            let Some(leafs) = leaves.media_container.metadata else {
                return Err(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: format!("{} ({}) - {}", item.title, lot, item.key),
                    error: Some("No episodes found".to_string()),
                });
            };
            for leaf in leafs {
                if leaf.last_viewed_at.is_some() {
                    result_item
                        .seen_history
                        .push(ImportOrExportMetadataItemSeen {
                            ended_on: leaf.last_viewed_at,
                            show_episode_number: leaf.index,
                            show_season_number: leaf.parent_index,
                            providers_consumed_on: Some(vec![ImportSource::Plex.to_string()]),
                            ..Default::default()
                        });
                }
            }
            result_item
        }
        _ => unreachable!(),
    };

    Ok(ImportCompletedItem::Metadata(result))
}

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
            .query(&[("includeGuids", "1")])
            .send()
            .await?
            .json::<plex_models::PlexMediaResponse<plex_models::PlexMetadata>>()
            .await?;
        let Some(metadata) = items.media_container.metadata else {
            failed_items.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::ItemDetailsFromSource,
                identifier: format!("{} ({}) - {}", dir.title, lot, dir.key),
                error: Some("No metadata found".to_string()),
            });
            continue;
        };
        let total = metadata.len();

        let results: Vec<_> = stream::iter(metadata.into_iter().enumerate())
            .map(|(idx, item)| {
                process_metadata_item(idx, item, total, lot, &client, &input.api_url)
            })
            .buffer_unordered(5)
            .collect()
            .await;

        for result in results {
            match result {
                Ok(item) => success_items.push(item),
                Err(error_item) => failed_items.push(error_item),
            }
        }
    }

    Ok(ImportResult {
        completed: success_items,
        failed: failed_items,
    })
}
