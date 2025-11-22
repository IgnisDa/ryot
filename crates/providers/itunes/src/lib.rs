use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{EntityAssets, NamedObject, SearchDetails};
use common_utils::{PAGE_SIZE, get_base_http_client};
use database_models::{metadata, prelude::Metadata};
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataFreeCreator, MetadataSearchItem, PodcastEpisode, PodcastSpecifics,
};
use reqwest::Client;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::MediaProvider;

static URL: &str = "https://itunes.apple.com";

pub struct ITunesService {
    client: Client,
    language: String,
    ss: Arc<SupportingService>,
}

impl ITunesService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let client = get_base_http_client(None);
        let language = ss.config.podcasts.itunes.locale.clone();
        Ok(Self {
            ss,
            client,
            language,
        })
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        vec!["en_us".to_string(), "ja_jp".to_string()]
    }

    pub fn get_default_language(&self) -> String {
        "en_us".to_owned()
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
    genres: Option<Vec<Genre>>,
    track_count: Option<usize>,
    track_name: Option<String>,
    description: Option<String>,
    artist_name: Option<String>,
    track_time_millis: Option<i32>,
    artwork_url_30: Option<String>,
    artwork_url_60: Option<String>,
    artwork_url_100: Option<String>,
    artwork_url_600: Option<String>,
    release_date: Option<DateTimeUtc>,
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
            .get(format!("{URL}/lookup"))
            .query(&[
                ("id", identifier),
                ("media", "podcast"),
                ("entity", "podcast"),
                ("lang", self.language.as_str()),
            ])
            .send()
            .await?;
        let details: SearchResponse = rsp.json().await?;
        let ht = details.results.unwrap()[0].clone();
        let description = ht.description.clone();
        let creators = Vec::from_iter(ht.artist_name.clone())
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a,
                role: "Artist".to_owned(),
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
            .get(format!("{URL}/lookup"))
            .query(&[
                ("id", identifier),
                ("media", "podcast"),
                ("entity", "podcastEpisode"),
                ("lang", self.language.as_str()),
                ("limit", &total_episodes.to_string()),
            ])
            .send()
            .await?;
        let remote_images = details.image.into_iter().collect();
        let assets = EntityAssets {
            remote_images,
            ..Default::default()
        };
        let episodes: SearchResponse = rsp.json().await?;
        let new_episodes = episodes.results.unwrap_or_default();
        let publish_date = new_episodes
            .last()
            .and_then(|e| e.release_date.to_owned())
            .map(|d| d.date_naive());

        let existing_metadata = Metadata::find()
            .filter(metadata::Column::Identifier.eq(identifier))
            .filter(metadata::Column::Lot.eq(MediaLot::Podcast))
            .filter(metadata::Column::Source.eq(MediaSource::Itunes))
            .one(&self.ss.db)
            .await?;

        let existing_episodes = existing_metadata
            .and_then(|m| m.podcast_specifics)
            .map(|ps| ps.episodes)
            .unwrap_or_default();

        let mut episodes_by_id: HashMap<String, PodcastEpisode> = HashMap::new();

        for episode in existing_episodes {
            episodes_by_id.insert(episode.id.clone(), episode);
        }

        for itunes_episode in new_episodes {
            let episode_id = itunes_episode.track_id.unwrap().to_string();
            episodes_by_id
                .entry(episode_id.clone())
                .or_insert_with(|| PodcastEpisode {
                    number: 0,
                    id: episode_id,
                    overview: itunes_episode.description,
                    thumbnail: itunes_episode.artwork_url_60,
                    title: itunes_episode.track_name.unwrap(),
                    runtime: itunes_episode.track_time_millis.map(|t| t / 1000 / 60),
                    publish_date: itunes_episode.release_date.map(|d| d.date_naive()).unwrap(),
                });
        }

        let mut episodes: Vec<PodcastEpisode> = episodes_by_id.into_values().collect();
        episodes.sort_by_key(|e| e.publish_date);

        for (idx, episode) in episodes.iter_mut().enumerate() {
            if episode.number == 0 {
                episode.number = (idx + 1).try_into().unwrap();
            }
        }

        episodes.reverse();
        Ok(MetadataDetails {
            assets,
            genres,
            creators,
            description,
            publish_date,
            title: details.title.clone(),
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
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let rsp = self
            .client
            .get(format!("{URL}/search"))
            .query(&[
                ("term", query),
                ("media", "podcast"),
                ("entity", "podcast"),
                ("lang", self.language.as_str()),
            ])
            .send()
            .await?;
        let search: SearchResponse = rsp.json().await?;
        let resp = search
            .results
            .unwrap_or_default()
            .into_iter()
            .map(get_search_response)
            .collect_vec();

        let total_items = resp.len().try_into().unwrap();

        let resp = resp
            .into_iter()
            .skip((page.saturating_sub(1) * PAGE_SIZE).try_into().unwrap())
            .take(PAGE_SIZE.try_into().unwrap())
            .collect_vec();

        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                total_items,
                next_page: (total_items > page * PAGE_SIZE).then(|| page + 1),
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
        publish_year,
        title: item.collection_name,
        image: images.first().cloned(),
        identifier: item.collection_id.to_string(),
    }
}
