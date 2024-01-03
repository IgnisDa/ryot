use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use database::{MetadataLot, MetadataSource};
use http_types::mime;
use itertools::Itertools;
use sea_orm::prelude::ChronoDateTimeUtc;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataFreeCreator,
            MetadataImageForMediaDetails, MetadataImageLot, PodcastEpisode, PodcastSpecifics,
        },
        NamedObject, SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://itunes.apple.com/";

#[derive(Debug, Clone)]
pub struct ITunesService {
    client: Client,
    language: String,
    page_limit: i32,
}

impl MediaProviderLanguages for ITunesService {
    fn supported_languages() -> Vec<String> {
        ["en_us", "ja_jp"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "en_us".to_owned()
    }
}

impl ITunesService {
    pub async fn new(config: &config::ITunesConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
        Self {
            client,
            language: config.locale.clone(),
            page_limit,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum Genre {
    Flat(String),
    Nested(NamedObject),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ITunesItem {
    collection_id: i64,
    track_name: Option<String>,
    collection_name: String,
    release_date: Option<ChronoDateTimeUtc>,
    description: Option<String>,
    artist_name: Option<String>,
    genres: Option<Vec<Genre>>,
    track_count: Option<i32>,
    track_id: Option<i64>,
    artwork_url_100: Option<String>,
    artwork_url_30: Option<String>,
    artwork_url_60: Option<String>,
    artwork_url_600: Option<String>,
    track_time_millis: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Option<Vec<ITunesItem>>,
}

#[async_trait]
impl MediaProvider for ITunesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self
            .client
            .get("lookup")
            .query(&serde_json::json!({
                "id": identifier,
                "media": "podcast",
                "entity": "podcast",
                "lang": self.language
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let details: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let ht = details.results.unwrap()[0].clone();
        let description = ht.description.clone();
        let creators = Vec::from_iter(ht.artist_name.clone())
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a,
                role: "Artist".to_owned(),
                image: None,
            })
            .collect();
        let genres = ht
            .genres
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|g| match g {
                Genre::Flat(s) => s,
                Genre::Nested(s) => s.name,
            })
            .collect();
        let total_episodes = ht.track_count.unwrap();
        let details = get_search_response(ht);
        let mut rsp = self
            .client
            .get("lookup")
            .query(&serde_json::json!({
                "id": identifier,
                "media": "podcast",
                "entity": "podcastEpisode",
                "limit": total_episodes,
                "lang": self.language
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let url_images = details
            .image
            .into_iter()
            .map(|a| MetadataImageForMediaDetails {
                image: a,
                lot: MetadataImageLot::Poster,
            })
            .collect();
        let episodes: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let episodes = episodes.results.unwrap_or_default();
        let publish_date = episodes
            .last()
            .and_then(|e| e.release_date.to_owned())
            .map(|d| d.date_naive());
        let mut episodes = episodes
            .into_iter()
            .enumerate()
            .rev()
            .map(|(idx, e)| PodcastEpisode {
                number: i32::try_from(idx).unwrap() + 1,
                id: e.track_id.unwrap().to_string(),
                runtime: e.track_time_millis.map(|t| t / 1000 / 60),
                overview: e.description,
                title: e.track_name.unwrap(),
                publish_date: e.release_date.map(|d| d.date_naive()).unwrap(),
                thumbnail: e.artwork_url_60,
            })
            .collect_vec();
        episodes.reverse();
        Ok(MediaDetails {
            identifier: details.identifier,
            title: details.title,
            publish_date,
            publish_year: publish_date.map(|d| d.year()),
            source: MetadataSource::Itunes,
            lot: MetadataLot::Podcast,
            description,
            url_images,
            creators,
            genres,
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                episodes,
                total_episodes,
            }),
            // DEV: API does not return any ratings
            provider_rating: None,
            // DEV: I could not find a way to get similar podcasts from the API
            suggestions: vec![],
            group_identifiers: vec![],
            videos: vec![],
            is_nsfw: None,
            people: vec![],
            s3_images: vec![],
            production_status: None,
            original_language: None,
        })
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .get("search")
            .query(&serde_json::json!({
                "term": query,
                "media": "podcast",
                "entity": "podcast",
                "lang": self.language
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .unwrap_or_default()
            .into_iter()
            .map(get_search_response)
            .collect_vec();

        let total = resp.len().try_into().unwrap();

        let resp = resp
            .into_iter()
            .skip(((page - 1) * self.page_limit).try_into().unwrap())
            .take(self.page_limit.try_into().unwrap())
            .collect_vec();

        Ok(SearchResults {
            details: SearchDetails {
                total,
                next_page: if total > page * self.page_limit {
                    Some(page + 1)
                } else {
                    None
                },
            },
            items: resp,
        })
    }
}

fn get_search_response(item: ITunesItem) -> MediaSearchItem {
    let mut images = vec![];
    if let Some(a) = item.artwork_url_600 {
        images.push(a);
    }
    if let Some(a) = item.artwork_url_100 {
        images.push(a);
    }
    if let Some(a) = item.artwork_url_30 {
        images.push(a);
    }
    if let Some(a) = item.artwork_url_60 {
        images.push(a);
    }
    let date = item.release_date.map(|d| d.date_naive());
    let publish_year = date.map(|d| d.year());
    MediaSearchItem {
        identifier: item.collection_id.to_string(),
        title: item.collection_name,
        image: images.first().cloned(),
        publish_year,
    }
}
