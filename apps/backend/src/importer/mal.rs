use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use flate2::bufread::GzDecoder;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::importer::{DeployMalImportInput, ImportResult};

fn decode_data<T>(path: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    let data = BufReader::new(File::open(path)?);
    let mut decoder = GzDecoder::new(data);
    let mut string_data = String::new();
    decoder.read_to_string(&mut string_data)?;
    dbg!(&string_data);
    let deserialized = serde_xml_rs::from_str::<T>(&string_data)?;
    Ok(deserialized)
}

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    dbg!(&input);
    let anime_data = decode_data::<AnimeRoot>(&input.anime)?;
    dbg!(&anime_data);
    // let manga_data = decode_data::<Root>(&input.manga)?;
    // dbg!(&manga_data);
    Ok(ImportResult {
        collections: vec![],
        media: vec![],
        failed_items: vec![],
    })
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct AnimeRoot {
    myanimelist: Myanimelist,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Myanimelist {
    anime: Vec<Anime>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Anime {
    series_animedb_id: i64,
    series_title: SeriesTitle,
    series_type: String,
    series_episodes: i64,
    my_id: i64,
    my_watched_episodes: i64,
    my_start_date: String,
    my_finish_date: String,
    my_rated: String,
    my_score: i64,
    my_storage: String,
    my_storage_value: i64,
    my_status: String,
    my_comments: MyComments,
    my_times_watched: i64,
    my_rewatch_value: String,
    my_priority: String,
    my_tags: MyTags,
    my_rewatching: i64,
    my_rewatching_ep: i64,
    my_discuss: i64,
    my_sns: String,
    update_on_import: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct SeriesTitle {
    cdata: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct MyComments {
    cdata: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct MyTags {
    cdata: String,
}
