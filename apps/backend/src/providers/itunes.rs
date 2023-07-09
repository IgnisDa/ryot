use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use itertools::Itertools;
use sea_orm::prelude::ChronoDateTimeUtc;
use serde::{Deserialize, Serialize};
use surf::{Client, Url};

use crate::{
    config::ITunesConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl},
    models::{
        media::{MediaDetails, MediaSearchItem, PodcastEpisode, PodcastSpecifics},
        SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{get_base_http_client_config, NamedObject, PAGE_LIMIT},
};

pub static URL: &str = "https://itunes.apple.com/";

#[derive(Debug, Clone)]
pub struct ITunesService {
    client: Client,
    language: String,
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
    pub async fn new(config: &ITunesConfig) -> Self {
        let client = get_base_http_client_config()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap();
        Self {
            client,
            language: config.locale.clone(),
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
            .map(|a| MetadataCreator {
                name: a,
                role: "Artist".to_owned(),
                image_urls: vec![],
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
        let images = details
            .image
            .into_iter()
            .map(|a| MetadataImage {
                url: MetadataImageUrl::Url(a),
                lot: MetadataImageLot::Poster,
            })
            .collect();
        let episodes: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let episodes = episodes.results.unwrap_or_default();
        let publish_date = episodes
            .last()
            .and_then(|e| e.release_date.to_owned())
            .map(|d| d.date_naive());
        let episodes = episodes
            .into_iter()
            .enumerate()
            .rev()
            .map(|(idx, e)| PodcastEpisode {
                number: i32::try_from(idx).unwrap() + 1,
                id: e.track_id.unwrap().to_string(),
                runtime: e.track_time_millis.map(|t| t / 1000 / 60),
                overview: e.description,
                title: e.track_name.unwrap(),
                publish_date: e.release_date.map(|d| d.timestamp()).unwrap(),
                thumbnail: e.artwork_url_60,
            })
            .collect_vec();
        Ok(MediaDetails {
            identifier: details.identifier,
            title: details.title,
            publish_date,
            publish_year: publish_date.map(|d| d.year()),
            source: MetadataSource::Itunes,
            lot: MetadataLot::Podcast,
            description,
            images,
            creators,
            genres,
            specifics: MediaSpecifics::Podcast(PodcastSpecifics {
                episodes,
                total_episodes,
            }),
        })
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .get("search")
            .query(&serde_json::json!({
                "term": query,
                "limit": PAGE_LIMIT,
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
            .collect();

        // DEV: API does not return total count
        let total = 100;

        Ok(SearchResults {
            total,
            items: resp,
            next_page: Some(page + 1),
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
        lot: MetadataLot::Podcast,
        title: item.collection_name,
        image: images.get(0).cloned(),
        publish_year,
    }
}
