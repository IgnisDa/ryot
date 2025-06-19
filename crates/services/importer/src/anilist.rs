use std::{collections::HashMap, fs, sync::Arc};

use async_graphql::Result;
use chrono::NaiveDateTime;
use common_utils::convert_naive_to_utc_datetime;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource, Visibility};
use media_models::{
    DeployJsonImportInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use nest_struct::nest_struct;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Deserialize;
use supporting_service::SupportingService;

use super::utils;

#[nest_struct]
#[derive(Debug, Deserialize)]
struct AnilistExport {
    user: nest! {
        custom_lists: nest! {
            anime: Vec<String>,
            manga: Vec<String>,
        },
    },
    lists: Vec<
        nest! {
            id: u64,
            progress: u32,
            score: Decimal,
            series_id: i32,
            series_type: u8,
            progress_volume: u32,
            notes: Option<String>,
            updated_at: Option<String>,
            custom_lists: Option<String>,
        },
    >,
    reviews: Vec<
        nest! {
            id: u64,
            private: u8,
            text: String,
            series_id: i32,
            score: Decimal,
            summary: String,
            series_type: u8,
            updated_at: String,
        },
    >,
    favourites: Vec<
        nest! {
            favourite_id: i32,
            favourite_type: u8,
        },
    >,
}

pub async fn import(
    input: DeployJsonImportInput,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let data = serde_json::from_str::<AnilistExport>(&export)?;
    let user_lists = data.user.custom_lists;
    let mut completed = vec![];
    let anime_custom_lists = user_lists
        .anime
        .into_iter()
        .enumerate()
        .collect::<HashMap<_, _>>();
    let manga_custom_lists = user_lists
        .manga
        .into_iter()
        .enumerate()
        .collect::<HashMap<_, _>>();
    for item in data.lists {
        let progress = [item.progress, item.progress_volume].into_iter().max();
        let lot = anilist_series_type_to_lot(item.series_type);
        let mut to_push_item = ImportOrExportMetadataItem {
            lot,
            source: MediaSource::Anilist,
            source_id: item.id.to_string(),
            identifier: item.series_id.to_string(),
            ..Default::default()
        };
        for num in 1..progress.unwrap_or_default() + 1 {
            let mut history = ImportOrExportMetadataItemSeen {
                provider_watched_on: Some(ImportSource::Anilist.to_string()),
                ended_on: item
                    .updated_at
                    .clone()
                    .map(|d| convert_naive_to_utc_datetime(parse_date_string(&d))),
                ..Default::default()
            };
            match lot {
                MediaLot::Anime => {
                    history.anime_episode_number = Some(num.try_into().unwrap());
                }
                MediaLot::Manga => {
                    history.manga_chapter_number = Some(num.into());
                }
                _ => unreachable!(),
            }
            to_push_item.seen_history.push(history);
        }
        let in_lists = match item.custom_lists {
            None => vec![],
            Some(l) => serde_json::from_str::<Vec<usize>>(&l)?,
        };
        for in_list in in_lists.iter() {
            match lot {
                MediaLot::Anime => {
                    if let Some(list) = anime_custom_lists.get(in_list) {
                        to_push_item.collections.push(list.clone());
                    }
                }
                MediaLot::Manga => {
                    if let Some(list) = manga_custom_lists.get(in_list) {
                        to_push_item.collections.push(list.clone());
                    }
                }
                _ => unreachable!(),
            }
        }
        let mut default_review = ImportOrExportItemRating {
            ..Default::default()
        };
        if item.score > dec!(0) {
            default_review.rating = Some(item.score);
        }
        if let Some(notes) = item.notes {
            if !notes.is_empty() {
                default_review.review = Some(ImportOrExportItemReview {
                    text: Some(notes),
                    ..Default::default()
                });
            }
        }
        to_push_item.reviews.push(default_review);
        completed.push(ImportCompletedItem::Metadata(to_push_item));
    }
    for review in data.reviews {
        let lot = anilist_series_type_to_lot(review.series_type);
        let visibility = anilist_private_status_to_visibility(review.private);
        let entire_text = format!("{}\n\n{}", review.summary, review.text);
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source: MediaSource::Anilist,
            source_id: review.id.to_string(),
            identifier: review.series_id.to_string(),
            reviews: vec![ImportOrExportItemRating {
                rating: Some(review.score),
                review: Some(ImportOrExportItemReview {
                    text: Some(entire_text),
                    visibility: Some(visibility),
                    date: Some(utils::get_date_time_with_offset(
                        parse_date_string(&review.updated_at),
                        &ss.timezone,
                    )),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        }));
    }
    for favorite in data.favourites {
        let lot = anilist_favorite_type_to_lot(favorite.favourite_type);
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source: MediaSource::Anilist,
            collections: vec!["Favorite".to_string()],
            identifier: favorite.favourite_id.to_string(),
            ..Default::default()
        }));
    }
    Ok(ImportResult {
        completed,
        ..Default::default()
    })
}

fn parse_date_string(input: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(input, "%Y-%m-%d %H:%M:%S").unwrap()
}

fn anilist_series_type_to_lot(series_type: u8) -> MediaLot {
    match series_type {
        1 => MediaLot::Manga,
        _ => MediaLot::Anime,
    }
}

fn anilist_favorite_type_to_lot(favourite_type: u8) -> MediaLot {
    match favourite_type {
        1 => MediaLot::Anime,
        _ => MediaLot::Manga,
    }
}

fn anilist_private_status_to_visibility(private: u8) -> Visibility {
    match private {
        1 => Visibility::Private,
        _ => Visibility::Public,
    }
}
