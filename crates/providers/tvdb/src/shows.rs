use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics,
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
    models::{TvdbSeasonExtendedResponse, TvdbShowExtendedResponse, URL},
};

pub struct TvdbShowService(TvdbService);

impl TvdbShowService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self(TvdbService::new(ss).await?))
    }
}

#[async_trait]
impl MediaProvider for TvdbShowService {
    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        self.0.trigger_search(page, query, "series").await
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let series_rsp = self
            .0
            .client
            .get(format!("{URL}/series/{identifier}/extended"))
            .send()
            .await?;
        let series_data: TvdbShowExtendedResponse = series_rsp.json().await?;
        let show_data = series_data.data;

        let title = show_data.common.name.unwrap_or_default();

        let mut remote_images = vec![];
        if let Some(artworks) = show_data.common.artworks {
            remote_images.extend(
                artworks
                    .into_iter()
                    .filter_map(|art| art.image)
                    .collect_vec(),
            );
        }
        if let Some(image) = show_data.common.image {
            remote_images.push(image);
        }

        let mut remote_videos = vec![];
        if let Some(trailers) = show_data.common.trailers {
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
        if let Some(characters) = show_data.common.characters {
            people.extend(
                characters
                    .into_iter()
                    .filter_map(
                        |chr| match (chr.people_id, chr.person_name, chr.people_type) {
                            (Some(id), Some(name), Some(role)) => Some(PartialMetadataPerson {
                                name,
                                role,
                                character: chr.name,
                                source: MediaSource::Tvdb,
                                identifier: id.to_string(),
                                ..Default::default()
                            }),
                            _ => None,
                        },
                    )
                    .collect_vec(),
            );
        }

        if let Some(companies) = show_data.companies {
            people.extend(
                companies
                    .iter()
                    .map(|company| {
                        let role = company
                            .company_type
                            .as_ref()
                            .map(|ct| ct.name.as_str())
                            .unwrap_or("Company");

                        PartialMetadataPerson {
                            role: role.to_string(),
                            source: MediaSource::Tvdb,
                            name: company.name.clone(),
                            identifier: company.id.to_string(),
                            source_specifics: Some(PersonSourceSpecifics {
                                is_tvdb_company: Some(true),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }
                    })
                    .collect_vec(),
            );
        }

        let genres = show_data
            .common
            .genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect_vec();

        let publish_date = show_data
            .common
            .first_air_date
            .as_ref()
            .and_then(|date| convert_string_to_date(date));

        let publish_year = show_data
            .common
            .year
            .and_then(|t| t.parse().ok())
            .or_else(|| {
                show_data
                    .common
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
            season_map.entry(season.number).or_insert(season.id);
        }

        let season_ids: Vec<i32> = season_map.into_values().collect();

        let seasons: Vec<TvdbSeasonExtendedResponse> = stream::iter(season_ids)
            .map(|season_id| async move {
                let rsp = self
                    .0
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

        let source_url = Some(format!(
            "https://thetvdb.com/series/{}",
            show_data.common.slug.as_deref().unwrap_or(identifier)
        ));

        Ok(MetadataDetails {
            genres,
            people,
            source_url,
            publish_date,
            publish_year,
            title: title.clone(),
            external_identifiers,
            description: show_data.common.overview,
            original_language: self.0.get_language_name(show_data.common.original_language),
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
