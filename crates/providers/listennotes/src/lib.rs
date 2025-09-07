use std::{collections::HashMap, env, sync::Arc};

use anyhow::Result;
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{EntityAssets, IdAndNamedObject, SearchDetails};
use common_utils::{PAGE_SIZE, convert_naive_to_utc};
use dependent_models::MetadataSearchSourceSpecifics;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataFreeCreator, MetadataSearchItem, PartialMetadataWithoutId,
    PodcastEpisode, PodcastSpecifics,
};
use reqwest::{
    Client,
    header::{HeaderName, HeaderValue},
};
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{TimestampMilliSeconds, formats::Flexible, serde_as};
use supporting_service::SupportingService;
use traits::MediaProvider;

static URL: &str = "https://listen-api.listennotes.com/api/v2";

pub struct ListennotesService {
    url: String,
    client: Client,
    ss: Arc<SupportingService>,
}

impl ListennotesService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let url = env::var("LISTENNOTES_API_URL")
            .unwrap_or_else(|_| URL.to_owned())
            .as_str()
            .to_owned();
        let client = get_base_http_client(Some(vec![(
            HeaderName::from_static("x-listenapi-key"),
            HeaderValue::from_str(&ss.config.podcasts.listennotes.api_token)?,
        )]));
        Ok(Self { ss, url, client })
    }
}

#[async_trait]
impl MediaProvider for ListennotesService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let mut details = self
            .details_with_paginated_episodes(identifier, None, None)
            .await?;
        #[derive(Serialize, Deserialize, Debug)]
        struct Recommendation {
            id: String,
            title: String,
            thumbnail: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct RecommendationResp {
            recommendations: Vec<Recommendation>,
        }
        let rec_data: RecommendationResp = self
            .client
            .get(format!(
                "{}/podcasts/{}/recommendations",
                self.url, identifier
            ))
            .send()
            .await?
            .json()
            .await?;
        details.suggestions = rec_data
            .recommendations
            .into_iter()
            .map(|r| PartialMetadataWithoutId {
                title: r.title,
                image: r.thumbnail,
                identifier: r.id,
                lot: MediaLot::Podcast,
                source: MediaSource::Listennotes,
                ..Default::default()
            })
            .collect();

        if let Some(ref mut specifics) = details.podcast_specifics {
            loop {
                if specifics.total_episodes > specifics.episodes.len() {
                    let last_episode = specifics.episodes.last().unwrap();
                    let next_pub_date = last_episode.publish_date;
                    let episode_number = last_episode.number;
                    let new_details = self
                        .details_with_paginated_episodes(
                            identifier,
                            Some(convert_naive_to_utc(next_pub_date).timestamp()),
                            Some(episode_number),
                        )
                        .await?;
                    if let Some(p) = new_details.podcast_specifics {
                        specifics.episodes.extend(p.episodes);
                    }
                } else {
                    break;
                }
            }
        };
        Ok(details)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title_original: String,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            image: Option<String>,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct SearchResponse {
            total: u64,
            results: Vec<Podcast>,
            next_offset: Option<i32>,
        }

        let rsp = self
            .client
            .get(format!("{}/search", self.url))
            .query(&[
                ("q", query),
                ("type", "podcast"),
                ("offset", &((page - 1) * PAGE_SIZE).to_string()),
            ])
            .send()
            .await?;

        let search: SearchResponse = rsp.json().await?;
        let total_items = search.total;

        let next_page = search.next_offset.map(|_| page + 1);
        let resp = search
            .results
            .into_iter()
            .map(|r| MetadataSearchItem {
                identifier: r.id,
                title: r.title_original,
                image: r.image,
                publish_year: r.publish_date.map(|r| r.year()),
            })
            .collect_vec();
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }
}

impl ListennotesService {
    async fn get_genres(&self) -> Result<HashMap<i32, String>> {
        cache_service::get_or_set_with_callback(
            &self.ss,
            ApplicationCacheKey::ListennotesSettings,
            ApplicationCacheValue::ListennotesSettings,
            || async {
                #[derive(Debug, Serialize, Deserialize, Default)]
                struct GenreResponse {
                    genres: Vec<IdAndNamedObject>,
                }
                let rsp = self
                    .client
                    .get(format!("{}/genres", self.url))
                    .send()
                    .await?;
                let data: GenreResponse = rsp.json().await?;
                Ok(data.genres.into_iter().map(|g| (g.id, g.name)).collect())
            },
        )
        .await
        .map(|c| c.response)
    }

    // The API does not return all the episodes for a podcast, and instead needs to be
    // paginated through. It also does not return the episode number. So we have to
    // handle those manually.
    pub async fn details_with_paginated_episodes(
        &self,
        identifier: &str,
        next_pub_date: Option<i64>,
        episode_number: Option<i32>,
    ) -> Result<MetadataDetails> {
        #[serde_as]
        #[derive(Serialize, Deserialize, Debug)]
        struct Podcast {
            title: String,
            explicit_content: Option<bool>,
            description: Option<String>,
            listen_score: Option<Decimal>,
            id: String,
            #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
            #[serde(rename = "earliest_pub_date_ms")]
            publish_date: Option<DateTimeUtc>,
            publisher: Option<String>,
            image: Option<String>,
            episodes: Vec<PodcastEpisode>,
            genre_ids: Vec<i32>,
            total_episodes: usize,
        }
        let resp = self
            .client
            .get(format!("{}/podcasts/{}", self.url, identifier))
            .query(&[
                ("sort", "oldest_first"),
                (
                    "next_episode_pub_date",
                    &next_pub_date
                        .map(|d| d.to_string())
                        .unwrap_or_else(|| "null".to_owned()),
                ),
            ])
            .send()
            .await?;
        let podcast_data: Podcast = resp.json().await?;
        let genres = self.get_genres().await?;
        Ok(MetadataDetails {
            title: podcast_data.title.clone(),
            description: podcast_data.description,
            is_nsfw: podcast_data.explicit_content,
            publish_year: podcast_data.publish_date.map(|r| r.year()),
            publish_date: podcast_data.publish_date.map(|d| d.date_naive()),
            source_url: Some(format!(
                "https://www.listennotes.com/podcasts/{}-{}",
                podcast_data.title, identifier
            )),
            creators: Vec::from_iter(podcast_data.publisher.map(|p| MetadataFreeCreator {
                name: p,
                role: "Publishing".to_owned(),
            })),
            genres: podcast_data
                .genre_ids
                .into_iter()
                .filter_map(|g| genres.get(&g).cloned())
                .unique()
                .collect(),
            assets: EntityAssets {
                remote_images: Vec::from_iter(podcast_data.image),
                ..Default::default()
            },
            podcast_specifics: Some(PodcastSpecifics {
                episodes: podcast_data
                    .episodes
                    .into_iter()
                    .enumerate()
                    .map(|(idx, episode)| PodcastEpisode {
                        number: (episode_number.unwrap_or_default() + idx as i32 + 1),
                        runtime: episode.runtime.map(|r| r / 60), // the api responds in seconds
                        ..episode
                    })
                    .collect(),
                total_episodes: podcast_data.total_episodes,
            }),
            provider_rating: podcast_data.listen_score,
            ..Default::default()
        })
    }
}
