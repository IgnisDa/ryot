use std::{collections::HashMap, fs};

use async_graphql::Result;
use chrono::NaiveDateTime;
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::{ImportSource, MediaLot, MediaSource};
use media_models::{
    DeployJsonImportInput, ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use nest_struct::nest_struct;
use serde::Deserialize;

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
            progress: u8,
            series_id: i32,
            series_type: u8,
            updated_at: String,
            progress_volume: u8,
            custom_lists: String,
        },
    >,
    reviews: Vec<
        nest! {
            score: u8,
            private: u8,
            text: String,
            series_id: i32,
            summary: String,
        },
    >,
}

pub async fn import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let data = serde_json::from_str::<AnilistExport>(&export)?;
    let user_lists = data.user.custom_lists;
    let mut completed = vec![];
    let anime_custom_lists = user_lists
        .anime
        .into_iter()
        .enumerate()
        .map(|(idx, list_name)| (idx, list_name))
        .collect::<HashMap<_, _>>();
    let manga_custom_lists = user_lists
        .manga
        .into_iter()
        .enumerate()
        .map(|(idx, list_name)| (idx, list_name))
        .collect::<HashMap<_, _>>();
    for item in data.lists {
        let lot = match item.series_type {
            1 => MediaLot::Manga,
            _ => MediaLot::Anime,
        };
        let progress = [item.progress, item.progress_volume].into_iter().max();
        let mut db_item = ImportOrExportMetadataItem {
            lot,
            source_id: item.id.to_string(),
            identifier: item.series_id.to_string(),
            source: MediaSource::Anilist,
            collections: vec![],
            reviews: vec![],
            seen_history: vec![],
        };
        for num in 1..progress.unwrap_or_default() + 1 {
            let mut history = ImportOrExportMetadataItemSeen {
                provider_watched_on: Some(ImportSource::Anilist.to_string()),
                ended_on: Some(parse_date_string(&item.updated_at).date()),
                ..Default::default()
            };
            match lot {
                MediaLot::Anime => {
                    history.anime_episode_number = Some(num.try_into().unwrap());
                }
                MediaLot::Manga => {
                    history.manga_chapter_number = Some(num.try_into().unwrap());
                }
                _ => unreachable!(),
            }
            db_item.seen_history.push(history);
        }
        let in_lists = serde_json::from_str::<Vec<usize>>(&item.custom_lists)?;
        for in_list in in_lists.iter() {
            match lot {
                MediaLot::Anime => {
                    if let Some(list) = anime_custom_lists.get(in_list) {
                        db_item.collections.push(list.clone());
                    }
                }
                MediaLot::Manga => {
                    if let Some(list) = manga_custom_lists.get(in_list) {
                        db_item.collections.push(list.clone());
                    }
                }
                _ => unreachable!(),
            }
        }
        if !db_item.seen_history.is_empty() && !db_item.collections.is_empty() {
            completed.push(ImportCompletedItem::Metadata(db_item));
        }
    }
    dbg!(&completed);
    todo!();
    Ok(ImportResult {
        completed,
        ..Default::default()
    })
}

fn parse_date_string(input: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(input, "%Y-%m-%d %H:%M:%S").unwrap()
}
