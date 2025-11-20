use anyhow::Result;
use async_trait::async_trait;
use chrono::{Datelike, NaiveDate};
use common_models::{EntityAssets, NamedObject, SearchDetails};
use common_utils::PAGE_SIZE;
use common_utils::get_base_http_client;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataFreeCreator, MetadataSearchItem, PodcastEpisode, PodcastSpecifics,
};
use reqwest::Client;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use traits::MediaProvider;

static URL: &str = "https://itunes.apple.com";

#[derive(Debug, Clone)]
pub struct ITunesService {
    client: Client,
    language: String,
}

impl ITunesService {
    pub async fn new(config: &config_definition::ITunesConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self {
            client,
            language: config.locale.clone(),
        })
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        vec!["en_us".to_string(), "ja_jp".to_string()]
    }

    pub fn get_default_language(&self) -> String {
        "en_us".to_owned()
    }

    async fn fetch_rss_feed(&self, feed_url: &str) -> Result<rss::Channel> {
        let response = self.client.get(feed_url).send().await?;
        let content = response.bytes().await?;
        let channel = rss::Channel::read_from(&content[..])?;
        Ok(channel)
    }

    fn parse_duration_to_minutes(duration: &str) -> Option<i32> {
        let parts: Vec<&str> = duration.split(':').collect();
        match parts.len() {
            1 => parts[0].parse::<i32>().ok().map(|s| s / 60),
            2 => {
                let minutes = parts[0].parse::<i32>().ok()?;
                let seconds = parts[1].parse::<i32>().ok()?;
                Some(minutes + seconds / 60)
            }
            3 => {
                let hours = parts[0].parse::<i32>().ok()?;
                let minutes = parts[1].parse::<i32>().ok()?;
                let seconds = parts[2].parse::<i32>().ok()?;
                Some(hours * 60 + minutes + seconds / 60)
            }
            _ => None,
        }
    }

    fn parse_rfc2822_date(date_str: &str) -> Option<NaiveDate> {
        use chrono::DateTime;
        DateTime::parse_from_rfc2822(date_str)
            .ok()
            .map(|dt| dt.date_naive())
    }

    fn parse_episode_from_rss_item(
        &self,
        item: &rss::Item,
        episode_number: i32,
    ) -> Option<PodcastEpisode> {
        let title = item.title()?.to_string();
        let id = item
            .guid()
            .map(|g| g.value().to_string())
            .or_else(|| item.link().map(|l| l.to_string()))?;

        let publish_date = item
            .pub_date()
            .and_then(|d| Self::parse_rfc2822_date(d))
            .unwrap_or_else(|| chrono::Utc::now().date_naive());

        let runtime = item
            .itunes_ext()
            .and_then(|ext| ext.duration())
            .and_then(|d| Self::parse_duration_to_minutes(d));

        let thumbnail = item
            .itunes_ext()
            .and_then(|ext| ext.image())
            .map(|img| img.to_string());

        let overview = item.description().map(|d| d.to_string());

        Some(PodcastEpisode {
            id,
            title,
            runtime,
            overview,
            thumbnail,
            publish_date,
            number: episode_number,
        })
    }

    async fn fetch_rss_episodes(&self, feed_url: &str) -> Result<Vec<PodcastEpisode>> {
        let channel = self.fetch_rss_feed(feed_url).await?;

        let mut episodes: Vec<PodcastEpisode> = channel
            .items()
            .iter()
            .enumerate()
            .filter_map(|(idx, item)| {
                let episode_number = item
                    .itunes_ext()
                    .and_then(|ext| ext.episode())
                    .and_then(|ep| ep.parse::<i32>().ok())
                    .unwrap_or((idx + 1) as i32);

                self.parse_episode_from_rss_item(item, episode_number)
            })
            .collect();

        episodes.sort_by_key(|e| e.publish_date);

        for (idx, episode) in episodes.iter_mut().enumerate() {
            episode.number = (idx + 1) as i32;
        }

        episodes.reverse();

        Ok(episodes)
    }

    async fn fetch_itunes_api_episodes(
        &self,
        identifier: &str,
        total_episodes: usize,
    ) -> Result<Vec<PodcastEpisode>> {
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

        let episodes: SearchResponse = rsp.json().await?;
        let mut episodes = episodes
            .results
            .unwrap_or_default()
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
        Ok(episodes)
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
    feed_url: Option<String>,
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
        let feed_url = ht.feed_url.clone();
        let details = get_search_response(ht);

        let episodes = if let Some(ref url) = feed_url {
            match self.fetch_rss_episodes(url).await {
                Ok(rss_episodes) => rss_episodes,
                Err(_) => {
                    self.fetch_itunes_api_episodes(identifier, total_episodes)
                        .await?
                }
            }
        } else {
            self.fetch_itunes_api_episodes(identifier, total_episodes)
                .await?
        };

        let remote_images = details.image.into_iter().collect();
        let assets = EntityAssets {
            remote_images,
            ..Default::default()
        };
        let publish_date = episodes.last().map(|e| e.publish_date);
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
        identifier: item.collection_id.to_string(),
        title: item.collection_name,
        image: images.first().cloned(),
        publish_year,
    }
}
