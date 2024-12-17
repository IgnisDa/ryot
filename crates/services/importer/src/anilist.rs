use std::{collections::HashMap, fs};

use async_graphql::Result;
use dependent_models::ImportResult;
use media_models::DeployJsonImportInput;
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
            score: u8,
            progress: u8,
            series_id: i32,
            series_type: u8,
            started_on: u64,
            finished_on: u64,
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
    let lists = data.user.custom_lists;
    let anime_custom_lists = lists
        .anime
        .into_iter()
        .enumerate()
        .map(|(idx, list_name)| (idx + 1, list_name))
        .collect::<HashMap<_, _>>();
    let manga_custom_lists = lists
        .manga
        .into_iter()
        .enumerate()
        .map(|(idx, list_name)| (idx + 1, list_name))
        .collect::<HashMap<_, _>>();
    dbg!(anime_custom_lists, manga_custom_lists);
    todo!();
    Ok(ImportResult {
        ..Default::default()
    })
}
