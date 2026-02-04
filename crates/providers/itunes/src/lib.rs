use std::{cmp::Reverse, collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{EntityAssets, NamedObject, SearchDetails};
use common_utils::{PAGE_SIZE, get_base_http_client, ryot_log};
use database_models::{metadata, prelude::Metadata};
use dependent_models::{
    MetadataSearchSourceSpecifics, ProviderSupportedLanguageInformation, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    EntityTranslationDetails, MetadataDetails, MetadataFreeCreator, MetadataSearchItem,
    PodcastEpisode, PodcastSpecifics, PodcastTranslationExtraInformation,
    ShowTranslationExtraInformation,
};
use reqwest::Client;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::MediaProvider;

static URL: &str = "https://itunes.apple.com";

pub struct ITunesService {
    client: Client,
    ss: Arc<SupportingService>,
}

impl ITunesService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self { ss, client })
    }

    pub fn get_all_languages(&self) -> Vec<ProviderSupportedLanguageInformation> {
        vec![
            ProviderSupportedLanguageInformation {
                value: "en_us".to_owned(),
                label: "English (US)".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                value: "ja_jp".to_owned(),
                label: "Japanese".to_owned(),
            },
        ]
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
                ("lang", &self.get_default_language()),
            ])
            .send()
            .await?;
        let details: SearchResponse = rsp.json().await?;
        let ht = details
            .results
            .ok_or_else(|| anyhow!("No results found for podcast"))?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("Podcast not found"))?;
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
                ("lang", &self.get_default_language()),
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

        let existing_ids: HashSet<String> =
            existing_episodes.iter().map(|e| e.id.clone()).collect();

        let mut new_episodes_to_add: Vec<PodcastEpisode> = new_episodes
            .into_iter()
            .filter_map(|itunes_episode| {
                let episode_id = itunes_episode.track_id?.to_string();
                match existing_ids.contains(&episode_id) {
                    true => None,
                    false => Some(PodcastEpisode {
                        number: 0,
                        id: episode_id,
                        title: itunes_episode.track_name?,
                        overview: itunes_episode.description,
                        thumbnail: itunes_episode.artwork_url_60,
                        runtime: itunes_episode.track_time_millis.map(|t| t / 1000 / 60),
                        publish_date: itunes_episode.release_date.map(|d| d.date_naive())?,
                    }),
                }
            })
            .collect();

        new_episodes_to_add.sort_by_key(|e| Reverse(e.publish_date));

        let max_number = existing_episodes
            .iter()
            .map(|e| e.number)
            .max()
            .unwrap_or(0);

        let new_count = new_episodes_to_add.len();
        if new_count > 0 {
            ryot_log!(
                debug,
                "iTunes podcast {}: discovered {} new episode(s), assigning numbers {}-{}",
                identifier,
                new_count,
                max_number + 1,
                max_number + new_count as i32
            );
        }

        for (idx, episode) in new_episodes_to_add.iter_mut().enumerate() {
            episode.number = max_number + (new_count - idx) as i32;
        }

        new_episodes_to_add.extend(existing_episodes);
        let episodes = new_episodes_to_add;

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
                ("lang", &self.get_default_language()),
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

    async fn translate_metadata(
        &self,
        identifier: &str,
        target_language: &str,
        _show_extra_information: Option<&ShowTranslationExtraInformation>,
        podcast_extra_information: Option<&PodcastTranslationExtraInformation>,
    ) -> Result<EntityTranslationDetails> {
        if let Some(extra) = podcast_extra_information {
            let media = "podcast".to_owned();
            let entity = "podcastEpisode".to_owned();
            let language = target_language.to_owned();
            let metadata = Metadata::find()
                .filter(metadata::Column::Identifier.eq(identifier))
                .filter(metadata::Column::Lot.eq(MediaLot::Podcast))
                .filter(metadata::Column::Source.eq(MediaSource::Itunes))
                .one(&self.ss.db)
                .await?
                .ok_or_else(|| anyhow!("Podcast not found"))?;
            let episode_id = metadata
                .podcast_specifics
                .and_then(|specifics| {
                    specifics
                        .episodes
                        .into_iter()
                        .find(|episode| episode.number == extra.episode)
                        .map(|episode| episode.id)
                })
                .ok_or_else(|| anyhow!("Podcast episode not found"))?;
            let rsp = self
                .client
                .get(format!("{URL}/lookup"))
                .query(&[
                    ("media", &media),
                    ("id", &episode_id),
                    ("lang", &language),
                    ("entity", &entity),
                ])
                .send()
                .await?;
            let details: SearchResponse = rsp.json().await?;
            let item = details.results.and_then(|s| s.first().cloned());
            return Ok(EntityTranslationDetails {
                title: item.as_ref().and_then(|i| i.track_name.clone()),
                description: item.as_ref().and_then(|i| i.description.clone()),
                image: item.and_then(|i| {
                    i.artwork_url_600
                        .or(i.artwork_url_100)
                        .or(i.artwork_url_60)
                        .or(i.artwork_url_30)
                }),
            });
        }
        let rsp = self
            .client
            .get(format!("{URL}/lookup"))
            .query(&[
                ("id", identifier),
                ("media", "podcast"),
                ("entity", "podcast"),
                ("lang", target_language),
            ])
            .send()
            .await?;
        let details: SearchResponse = rsp.json().await?;
        let item = details.results.and_then(|s| s.first().cloned());
        Ok(EntityTranslationDetails {
            title: item.clone().map(|i| i.collection_name.clone()),
            description: item.and_then(|i| i.description.clone()),
            ..Default::default()
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
