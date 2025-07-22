use std::sync::Arc;

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, MetadataSearchSourceSpecifics,
    PersonSourceSpecifics, SearchDetails,
};
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, convert_date_to_year, convert_string_to_date};
use dependent_models::SearchResults;
use enum_models::{MediaLot, MediaSource};
use futures::{
    stream::{self, StreamExt},
    try_join,
};
use hashbag::HashBag;
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId,
    ShowEpisode, ShowSeason, ShowSpecifics,
};
use rust_decimal_macros::dec;
use serde_json::json;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{base::TmdbService, models::*};

pub struct TmdbShowService {
    pub base: TmdbService,
}

impl TmdbShowService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self {
            base: TmdbService::new(ss).await?,
        })
    }
}

#[async_trait]
impl MediaProvider for TmdbShowService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .base
            .client
            .get(format!("{}/tv/{}", URL, &identifier))
            .query(&json!({
                "language": self.base.language,
                "append_to_response": "videos",
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let show_data: TmdbMediaEntry = rsp.json().await.map_err(|e| anyhow!(e))?;
        let mut remote_videos = vec![];
        if let Some(vid) = show_data.videos {
            remote_videos.extend(vid.results.into_iter().map(|vid| EntityRemoteVideo {
                url: vid.key,
                source: EntityRemoteVideoSource::Youtube,
            }))
        }
        let mut image_ids = Vec::from_iter(show_data.poster_path);
        if let Some(u) = show_data.backdrop_path {
            image_ids.push(u);
        }
        let ((), suggestions) = try_join!(
            self.base.save_all_images("tv", identifier, &mut image_ids),
            self.base.get_all_suggestions("tv", identifier)
        )?;

        let seasons: Vec<TmdbSeason> = stream::iter(
            show_data
                .seasons
                .unwrap_or_default()
                .into_iter()
                .map(|s| s.season_number),
        )
        .map(|season_number| fetch_season_with_credits(season_number, identifier, &self.base))
        .buffer_unordered(5)
        .collect::<Vec<Result<TmdbSeason>>>()
        .await
        .into_iter()
        .collect::<Result<Vec<TmdbSeason>>>()?
        .into_iter()
        .sorted_by_key(|s| s.season_number)
        .collect();
        let mut people = seasons
            .iter()
            .flat_map(|s| {
                s.episodes
                    .iter()
                    .flat_map(|e| {
                        e.guest_stars
                            .clone()
                            .into_iter()
                            .flat_map(|g| {
                                g.id.and_then(|id| {
                                    g.known_for_department.map(|r| PartialMetadataPerson {
                                        role: r,
                                        character: g.character,
                                        source: MediaSource::Tmdb,
                                        identifier: id.to_string(),
                                        name: g.name.unwrap_or_default(),
                                        ..Default::default()
                                    })
                                })
                            })
                            .collect_vec()
                    })
                    .collect_vec()
            })
            .collect_vec();
        people.extend(
            show_data
                .production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| PartialMetadataPerson {
                    name: p.name,
                    source: MediaSource::Tmdb,
                    identifier: p.id.to_string(),
                    role: "Production Company".to_owned(),
                    source_specifics: Some(PersonSourceSpecifics {
                        is_tmdb_company: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .collect_vec(),
        );
        let people: HashBag<PartialMetadataPerson> = HashBag::from_iter(people);
        let people = Vec::from_iter(people.set_iter())
            .into_iter()
            .sorted_by_key(|c| c.1)
            .rev()
            .map(|c| c.0)
            .cloned()
            .collect_vec();
        let seasons_without_specials = seasons
            .iter()
            .filter(|s| !SHOW_SPECIAL_SEASON_NAMES.contains(&s.name.as_str()))
            .collect_vec();
        let total_runtime = seasons_without_specials
            .iter()
            .flat_map(|s| s.episodes.iter())
            .map(|e| e.runtime.unwrap_or_default())
            .sum();
        let total_seasons = seasons_without_specials.len();
        let total_episodes = seasons_without_specials
            .iter()
            .flat_map(|s| s.episodes.iter())
            .count();
        let (watch_providers, external_identifiers) = try_join!(
            self.base.get_all_watch_providers("tv", identifier),
            self.base.get_external_identifiers("tv", identifier)
        )?;
        let title = show_data.name.unwrap();

        let remote_images = image_ids
            .into_iter()
            .unique()
            .map(|p| self.base.get_image_url(p))
            .collect();

        Ok(MetadataDetails {
            people,
            suggestions,
            watch_providers,
            lot: MediaLot::Show,
            title: title.clone(),
            is_nsfw: show_data.adult,
            source: MediaSource::Tmdb,
            description: show_data.overview,
            production_status: show_data.status,
            identifier: show_data.id.to_string(),
            external_identifiers: Some(external_identifiers),
            original_language: self.base.get_language_name(show_data.original_language),
            publish_year: convert_date_to_year(
                &show_data.first_air_date.clone().unwrap_or_default(),
            ),
            publish_date: convert_string_to_date(
                &show_data.first_air_date.clone().unwrap_or_default(),
            ),
            source_url: Some(format!(
                "https://www.themoviedb.org/tv/{}-{}",
                show_data.id, title
            )),
            provider_rating: show_data
                .vote_average
                .filter(|&av| av != dec!(0))
                .map(|av| av * dec!(10)),
            genres: show_data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .unique()
                .collect(),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            show_specifics: Some(ShowSpecifics {
                runtime: if total_runtime == 0 {
                    None
                } else {
                    Some(total_runtime)
                },
                total_seasons: if total_seasons == 0 {
                    None
                } else {
                    Some(total_seasons)
                },
                total_episodes: if total_episodes == 0 {
                    None
                } else {
                    Some(total_episodes)
                },
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images =
                            Vec::from_iter(s.poster_path.map(|p| self.base.get_image_url(p)));
                        let backdrop_images =
                            Vec::from_iter(s.backdrop_path.map(|p| self.base.get_image_url(p)));
                        ShowSeason {
                            id: s.id,
                            name: s.name,
                            poster_images,
                            backdrop_images,
                            overview: s.overview,
                            season_number: s.season_number,
                            publish_date: convert_string_to_date(&s.air_date.unwrap_or_default()),
                            episodes: s
                                .episodes
                                .into_iter()
                                .map(|e| {
                                    let poster_images = Vec::from_iter(
                                        e.still_path.map(|p| self.base.get_image_url(p)),
                                    );
                                    ShowEpisode {
                                        id: e.id,
                                        name: e.name,
                                        poster_images,
                                        runtime: e.runtime,
                                        overview: e.overview,
                                        episode_number: e.episode_number,
                                        publish_date: convert_string_to_date(
                                            &e.air_date.unwrap_or_default(),
                                        ),
                                    }
                                })
                                .collect(),
                        }
                    })
                    .collect(),
            }),
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .base
            .client
            .get(format!("{}/search/tv", URL))
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
                "include_adult": display_nsfw,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.id.to_string(),
                title: d.title.unwrap_or_default(),
                publish_year: convert_date_to_year(&d.first_air_date.unwrap()),
                image: d.poster_path.map(|p| self.base.get_image_url(p)),
            })
            .collect_vec();
        let next_page = (page < search.total_pages).then(|| page + 1);
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_results,
                next_page,
            },
            items: resp.to_vec(),
        })
    }

    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        self.base.get_trending_media("tv").await
    }
}

pub async fn fetch_season_with_credits(
    season_number: i32,
    identifier: &str,
    base: &TmdbService,
) -> Result<TmdbSeason> {
    let season_data_future = base
        .client
        .get(format!(
            "{}/tv/{}/season/{}",
            URL, identifier, season_number
        ))
        .query(&json!({ "language": base.language }))
        .send();

    let season_credits_future = base
        .client
        .get(format!(
            "{}/tv/{}/season/{}/credits",
            URL, identifier, season_number
        ))
        .query(&json!({ "language": base.language }))
        .send();

    let (season_resp, credits_resp) = try_join!(season_data_future, season_credits_future)?;

    let mut season_data: TmdbSeason = season_resp.json().await.map_err(|e| anyhow!(e))?;
    let credits: TmdbSeasonCredit = credits_resp.json().await.map_err(|e| anyhow!(e))?;

    for episode in season_data.episodes.iter_mut() {
        episode.guest_stars.extend(credits.cast.clone());
    }

    Ok(season_data)
}
