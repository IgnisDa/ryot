use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{convert_date_to_year, convert_string_to_date};
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use enum_models::MediaSource;
use futures::stream::{self, StreamExt};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataExternalIdentifiers, MetadataSearchItem, PartialMetadataPerson,
    ShowEpisode, ShowSeason, ShowSpecifics,
};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TvdbService,
    models::{TvdbSearchResponse, TvdbSeasonExtendedResponse, TvdbShowExtendedResponse, URL},
};

pub struct TvdbShowService {
    pub base: TvdbService,
}

impl TvdbShowService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self {
            base: TvdbService::new(ss).await?,
        })
    }
}

#[async_trait]
impl MediaProvider for TvdbShowService {
    async fn metadata_search(
        &self,
        page: i32,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let limit = 20;
        let offset = (page - 1) * limit;

        let rsp = self
            .base
            .client
            .get(format!("{URL}/search"))
            .query(&[
                ("query", query),
                ("type", "series"),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
            ])
            .send()
            .await?;
        let search: TvdbSearchResponse = rsp.json().await?;

        let (next_page, total_items) = search.get_pagination(page);

        let resp = search
            .data
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.tvdb_id,
                image: d.poster.or(d.image_url),
                title: d.title.or(d.name).unwrap_or_default(),
                ..Default::default()
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

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let series_rsp = self
            .base
            .client
            .get(format!("{URL}/series/{identifier}/extended"))
            .send()
            .await?;
        let series_data: TvdbShowExtendedResponse = series_rsp.json().await?;
        let show_data = series_data.data;

        let title = show_data.name.unwrap_or_default();

        let mut remote_images = vec![];
        if let Some(artworks) = show_data.artworks {
            remote_images.extend(
                artworks
                    .into_iter()
                    .filter_map(|art| art.image)
                    .collect_vec(),
            );
        }
        if let Some(image) = show_data.image {
            remote_images.push(image);
        }

        let mut remote_videos = vec![];
        if let Some(trailers) = show_data.trailers {
            remote_videos.extend(
                trailers
                    .into_iter()
                    .filter_map(|trailer| {
                        trailer.url.map(|url| EntityRemoteVideo {
                            url,
                            source: EntityRemoteVideoSource::Youtube,
                        })
                    })
                    .collect_vec(),
            );
        }

        let mut people = vec![];
        if let Some(characters) = show_data.characters {
            people.extend(
                characters
                    .into_iter()
                    .filter_map(|char| match (char.person_name, char.people_type) {
                        (Some(name), Some(role)) => Some(PartialMetadataPerson {
                            name,
                            role,
                            character: char.name,
                            source: MediaSource::Tvdb,
                            identifier: char.id.map(|id| id.to_string()).unwrap_or_default(),
                            ..Default::default()
                        }),
                        _ => None,
                    })
                    .collect_vec(),
            );
        }

        if let Some(companies) = show_data.companies {
            people.extend(
                companies
                    .into_iter()
                    .map(|company| PartialMetadataPerson {
                        name: company.name,
                        source: MediaSource::Tvdb,
                        identifier: company.id.to_string(),
                        role: "Production Company".to_string(),
                        source_specifics: Some(PersonSourceSpecifics {
                            is_tvdb_company: Some(true),
                            ..Default::default()
                        }),
                        ..Default::default()
                    })
                    .collect_vec(),
            );
        }

        let genres = show_data
            .genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect_vec();

        let publish_date = show_data
            .first_air_date
            .as_ref()
            .and_then(|date| convert_string_to_date(date));

        let publish_year = show_data.year.and_then(|t| t.parse().ok()).or_else(|| {
            show_data
                .first_air_date
                .as_ref()
                .and_then(|date| convert_date_to_year(date))
        });

        let external_identifiers = Some(MetadataExternalIdentifiers {
            tvdb_id: show_data.id,
        });

        let seasons_data = show_data.seasons.unwrap_or_default();

        let mut season_map = HashMap::new();
        for season in seasons_data {
            let _entry = season_map.entry(season.number).or_insert(season.id);
        }

        let season_ids: Vec<i32> = season_map.into_values().collect();

        let seasons: Vec<TvdbSeasonExtendedResponse> = stream::iter(season_ids)
            .map(|season_id| async move {
                let rsp = self
                    .base
                    .client
                    .get(format!("{URL}/seasons/{season_id}/extended"))
                    .send()
                    .await?;
                let season_data: TvdbSeasonExtendedResponse = rsp.json().await?;
                Ok::<TvdbSeasonExtendedResponse, anyhow::Error>(season_data)
            })
            .buffer_unordered(5)
            .collect::<Vec<Result<TvdbSeasonExtendedResponse>>>()
            .await
            .into_iter()
            .collect::<Result<Vec<TvdbSeasonExtendedResponse>>>()?;

        let mut official_seasons: Vec<_> = seasons
            .into_iter()
            .filter(|s| s.data.season_type.season_type == "official")
            .collect();

        official_seasons.sort_by_key(|s| s.data.number);

        let processed_seasons: Vec<ShowSeason> = official_seasons
            .into_iter()
            .map(|season_response| {
                let season = season_response.data;
                let season_episodes: Vec<ShowEpisode> = season
                    .episodes
                    .into_iter()
                    .map(|ep| ShowEpisode {
                        id: ep.id,
                        runtime: ep.runtime,
                        overview: ep.overview,
                        episode_number: ep.number,
                        name: ep.name.unwrap_or_default(),
                        poster_images: ep.image.into_iter().collect(),
                        publish_date: ep
                            .aired
                            .as_ref()
                            .and_then(|date| convert_string_to_date(date)),
                    })
                    .collect();

                let mut season_images = vec![];
                if let Some(image) = season.image {
                    season_images.push(image);
                }
                if let Some(artwork) = season.artwork {
                    season_images.extend(artwork.into_iter().map(|art| art.image));
                }

                ShowSeason {
                    id: season.id,
                    episodes: season_episodes,
                    season_number: season.number,
                    poster_images: season_images,
                    name: format!("Season {}", season.number),
                    publish_date: season.year.as_ref().and_then(|year| {
                        year.parse::<i32>()
                            .ok()
                            .and_then(|y| chrono::NaiveDate::from_ymd_opt(y, 1, 1))
                    }),
                    ..Default::default()
                }
            })
            .collect();

        let total_episodes = processed_seasons.iter().map(|s| s.episodes.len()).sum();
        let total_seasons = processed_seasons.len();
        let total_runtime: i32 = processed_seasons
            .iter()
            .flat_map(|s| s.episodes.iter())
            .map(|e| e.runtime.unwrap_or(0))
            .sum();

        Ok(MetadataDetails {
            genres,
            people,
            publish_date,
            publish_year,
            title: title.clone(),
            external_identifiers,
            description: show_data.overview,
            source_url: Some(format!("https://thetvdb.com/series/{}", identifier)),
            original_language: self.base.get_language_name(show_data.original_language),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            show_specifics: Some(ShowSpecifics {
                seasons: processed_seasons,
                runtime: (total_runtime != 0).then_some(total_runtime),
                total_seasons: (total_seasons != 0).then_some(total_seasons),
                total_episodes: (total_episodes != 0).then_some(total_episodes),
            }),
            ..Default::default()
        })
    }
}
