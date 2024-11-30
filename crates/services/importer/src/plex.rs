use application_utils::get_base_http_client;
use async_graphql::Result;
use common_models::StringIdObject;
use common_utils::ryot_log;
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::{ImportSource, MediaLot, MediaSource};
use importer_models::{ImportFailStep, ImportFailedItem};
use media_models::{
    DeployUrlAndKeyImportInput, ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use reqwest::header::{HeaderName, HeaderValue, ACCEPT};
use sea_orm::prelude::DateTimeUtc;
use serde::Deserialize;
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};

#[serde_as]
#[derive(Debug, Deserialize)]
struct PlexMetadataItem {
    title: String,
    #[serde(rename = "type")]
    item_type: String,
    #[serde(rename = "ratingKey")]
    rating_key: Option<String>,
    key: String,
    #[serde(rename = "Guid")]
    guid: Option<Vec<StringIdObject>>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    #[serde(rename = "lastViewedAt")]
    last_viewed_at: Option<DateTimeUtc>,
    index: Option<i32>,
    #[serde(rename = "parentIndex")]
    parent_index: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlexLibrary {
    pub directory: Vec<PlexMetadataItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlexMetadata {
    pub metadata: Vec<PlexMetadataItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PlexMediaResponse<T> {
    pub media_container: T,
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
        .json::<PlexMediaResponse<PlexLibrary>>()
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
            .json::<PlexMediaResponse<PlexMetadata>>()
            .await?;
        for item in items.media_container.metadata {
            if let Some(_) = item.last_viewed_at {
                let gu_ids = item.guid.unwrap_or_default();
                let Some(tmdb_id) = gu_ids
                    .iter()
                    .find(|g| g.id.starts_with("tmdb://"))
                    .map(|g| &g.id[7..])
                else {
                    failed_items.push(ImportFailedItem {
                        lot: Some(lot),
                        identifier: item.key.clone(),
                        step: ImportFailStep::ItemDetailsFromSource,
                        error: Some("No TMDb ID associated with this media".to_string()),
                    });
                    continue;
                };
                match lot {
                    MediaLot::Movie => {
                        success_items.push(ImportCompletedItem::Metadata(
                            ImportOrExportMetadataItem {
                                lot,
                                reviews: vec![],
                                source_id: item.key,
                                collections: vec![],
                                source: MediaSource::Tmdb,
                                identifier: tmdb_id.to_string(),
                                seen_history: vec![ImportOrExportMetadataItemSeen {
                                    ended_on: item.last_viewed_at.map(|d| d.date_naive()),
                                    provider_watched_on: Some(ImportSource::Plex.to_string()),
                                    ..Default::default()
                                }],
                            },
                        ));
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
                            .json::<PlexMediaResponse<PlexMetadata>>()
                            .await?;
                        let mut item = ImportOrExportMetadataItem {
                            lot,
                            reviews: vec![],
                            collections: vec![],
                            seen_history: vec![],
                            source: MediaSource::Tmdb,
                            source_id: item.key.clone(),
                            identifier: tmdb_id.to_string(),
                        };
                        for leaf in leaves.media_container.metadata {
                            if let Some(_) = leaf.last_viewed_at {
                                item.seen_history.push(ImportOrExportMetadataItemSeen {
                                    show_episode_number: leaf.index,
                                    show_season_number: leaf.parent_index,
                                    ended_on: leaf.last_viewed_at.map(|d| d.date_naive()),
                                    provider_watched_on: Some(ImportSource::Plex.to_string()),
                                    ..Default::default()
                                });
                            }
                        }
                        if !item.seen_history.is_empty() {
                            success_items.push(ImportCompletedItem::Metadata(item));
                        }
                    }
                    _ => unreachable!(),
                }
            }
        }
    }

    Ok(ImportResult {
        completed: success_items,
        failed: failed_items,
    })
}
