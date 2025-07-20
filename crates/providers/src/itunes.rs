use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{EntityAssets, MetadataSearchSourceSpecifics, NamedObject, SearchDetails};
use common_utils::PAGE_SIZE;
use dependent_models::SearchResults;
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataFreeCreator, MetadataSearchItem, PodcastEpisode, PodcastSpecifics,
};
use reqwest::Client;
use sea_orm::prelude::ChronoDateTimeUtc;
use serde::{Deserialize, Serialize};
use traits::MediaProvider;

static URL: &str = "https://itunes.apple.com";

#[derive(Debug, Clone)]
pub struct ITunesService {
    client: Client,
    language: String,
}

impl ITunesService {
    pub async fn new(config: &config::ITunesConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self {
            client,
            language: config.locale.clone(),
        })
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
    track_id: Option<i64>,
    collection_name: String,
    description: Option<String>,
    artist_name: Option<String>,
    genres: Option<Vec<Genre>>,
    track_count: Option<usize>,
    track_name: Option<String>,
    track_time_millis: Option<i32>,
    artwork_url_30: Option<String>,
    artwork_url_60: Option<String>,
    artwork_url_100: Option<String>,
    artwork_url_600: Option<String>,
    release_date: Option<ChronoDateTimeUtc>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Option<Vec<ITunesItem>>,
}

#[async_trait]
impl MediaProvider for ITunesService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .get(format!("{}/lookup", URL))
            .query(&serde_json::json!({
                "id": identifier,
                "media": "podcast",
                "entity": "podcast",
                "lang": self.language
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let details: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let ht = details.results.unwrap()[0].clone();
        let description = ht.description.clone();
        let creators = Vec::from_iter(ht.artist_name.clone())
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a,
                role: "Artist".to_owned(),
                ..Default::default()
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
        let rsp = self
            .client
            .get(format!("{}/lookup", URL))
            .query(&serde_json::json!({
                "id": identifier,
                "media": "podcast",
                "entity": "podcastEpisode",
                "limit": total_episodes,
                "lang": self.language
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let remote_images = details.image.into_iter().collect();
        let assets = EntityAssets {
            remote_images,
            ..Default::default()
        };
        let episodes: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let episodes = episodes.results.unwrap_or_default();
        let publish_date = episodes
            .last()
            .and_then(|e| e.release_date.to_owned())
            .map(|d| d.date_naive());
        let mut episodes = episodes
            .into_iter()
            .sorted_by_key(|e| e.release_date)
            .enumerate()
            .map(|(idx, e)| PodcastEpisode {
                overview: e.description,
                thumbnail: e.artwork_url_60,
                title: e.track_name.unwrap(),
                id: e.track_id.unwrap().to_string(),
                number: (idx + 1).try_into().unwrap(),
                runtime: e.track_time_millis.map(|t| t / 1000 / 60),
                publish_date: e.release_date.map(|d| d.date_naive()).unwrap(),
            })
            .collect_vec();
        episodes.reverse();
        Ok(MetadataDetails {
            assets,
            genres,
            creators,
            description,
            publish_date,
            lot: MediaLot::Podcast,
            source: MediaSource::Itunes,
            title: details.title.clone(),
            identifier: details.identifier,
            publish_year: publish_date.map(|d| d.year()),
            source_url: Some(format!(
                "https://podcasts.apple.com/us/podcast/{}/id{}",
                details.title, identifier
            )),
            podcast_specifics: Some(PodcastSpecifics {
                total_episodes: episodes.len(),
                episodes,
            }),
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .client
            .get(format!("{}/search", URL))
            .query(&serde_json::json!({
                "term": query,
                "media": "podcast",
                "entity": "podcast",
                "lang": self.language
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .unwrap_or_default()
            .into_iter()
            .map(get_search_response)
            .collect_vec();

        let total = resp.len().try_into().unwrap();

        let resp = resp
            .into_iter()
            .skip(((page - 1) * PAGE_SIZE).try_into().unwrap())
            .take(PAGE_SIZE.try_into().unwrap())
            .collect_vec();

        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                total,
                next_page: (total > page * PAGE_SIZE).then(|| page + 1),
            },
        })
    }
}

fn get_search_response(item: ITunesItem) -> MetadataSearchItem {
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
    MetadataSearchItem {
        identifier: item.collection_id.to_string(),
        title: item.collection_name,
        image: images.first().cloned(),
        publish_year,
    }
}
