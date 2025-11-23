use std::fs::read_to_string;

use anyhow::Result;
use common_models::DefaultCollection;
use dependent_models::{CollectionToEntityDetails, ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource, SeenState};
use media_models::{
    DeployPathImportInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItemSeen,
};
use rust_decimal::{Decimal, dec};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{ImportFailStep, ImportFailedItem, ImportOrExportMetadataItem};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatcharrExportItem {
    pinned: bool,
    status: String,
    rating: Decimal,
    thoughts: String,
    content: WatcharrContent,
    activity: Option<Vec<WatcharrActivity>>,
    watched_episodes: Option<Vec<WatcharrEpisode>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatcharrContent {
    tmdb_id: i64,
    title: String,
    #[serde(rename = "type")]
    content_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatcharrActivity {
    #[serde(rename = "type")]
    activity_type: String,
    custom_date: Option<DateTimeUtc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatcharrEpisode {
    status: String,
    season_number: i32,
    episode_number: i32,
    created_at: DateTimeUtc,
}

pub async fn import(input: DeployPathImportInput) -> Result<ImportResult> {
    let export = read_to_string(input.export_path)?;
    let items: Vec<WatcharrExportItem> = serde_json::from_str(&export)?;

    let mut completed = vec![];
    let mut failed = vec![];

    for item in items {
        match process_item(&item) {
            Ok(metadata) => completed.push(ImportCompletedItem::Metadata(metadata)),
            Err(e) => failed.push(e),
        }
    }

    Ok(ImportResult { completed, failed })
}

fn process_item(item: &WatcharrExportItem) -> Result<ImportOrExportMetadataItem, ImportFailedItem> {
    let lot = match item.content.content_type.as_str() {
        "movie" => MediaLot::Movie,
        "tv" => MediaLot::Show,
        _ => {
            return Err(ImportFailedItem {
                identifier: item.content.title.clone(),
                step: ImportFailStep::InputTransformation,
                error: Some(format!(
                    "Unknown content type: {}",
                    item.content.content_type
                )),
                ..Default::default()
            });
        }
    };

    let mut collections = vec![];

    match item.status.as_str() {
        "PLANNED" => collections.push(CollectionToEntityDetails {
            collection_name: DefaultCollection::Watchlist.to_string(),
            ..Default::default()
        }),
        "DROPPED" => collections.push(CollectionToEntityDetails {
            collection_name: "Dropped".to_string(),
            ..Default::default()
        }),
        _ => {}
    }

    if item.pinned {
        collections.push(CollectionToEntityDetails {
            collection_name: "Pinned".to_string(),
            ..Default::default()
        });
    }

    let mut reviews = vec![];
    if item.rating > dec!(0) || !item.thoughts.is_empty() {
        reviews.push(ImportOrExportItemRating {
            rating: match item.rating {
                r if r > dec!(0) => Some(r * dec!(10)),
                _ => None,
            },
            review: match item.thoughts.is_empty() {
                false => Some(ImportOrExportItemReview {
                    spoiler: Some(false),
                    text: Some(item.thoughts.clone()),
                    ..Default::default()
                }),
                true => None,
            },
            ..Default::default()
        });
    }

    let seen_history = if lot == MediaLot::Movie {
        if let Some(activity) = &item.activity {
            activity
                .iter()
                .filter_map(|act| match act.activity_type.as_str() {
                    "IMPORTED_ADDED_WATCHED" => Some(ImportOrExportMetadataItemSeen {
                        ended_on: act.custom_date,
                        state: Some(map_status_to_seen_state(&item.status)),
                        providers_consumed_on: Some(vec![ImportSource::Watcharr.to_string()]),
                        ..Default::default()
                    }),
                    _ => None,
                })
                .collect()
        } else {
            vec![]
        }
    } else if let Some(episodes) = &item.watched_episodes {
        episodes
            .iter()
            .map(|ep| ImportOrExportMetadataItemSeen {
                ended_on: Some(ep.created_at),
                show_season_number: Some(ep.season_number),
                show_episode_number: Some(ep.episode_number),
                state: Some(map_status_to_seen_state(&ep.status)),
                providers_consumed_on: Some(vec![ImportSource::Watcharr.to_string()]),
                ..Default::default()
            })
            .collect()
    } else {
        vec![]
    };

    Ok(ImportOrExportMetadataItem {
        lot,
        reviews,
        collections,
        seen_history,
        source: MediaSource::Tmdb,
        source_id: item.content.title.clone(),
        identifier: item.content.tmdb_id.to_string(),
    })
}

fn map_status_to_seen_state(status: &str) -> SeenState {
    match status {
        "DROPPED" => SeenState::Dropped,
        "FINISHED" => SeenState::Completed,
        "PLANNED" => SeenState::InProgress,
        "WATCHING" => SeenState::InProgress,
        _ => SeenState::InProgress,
    }
}
