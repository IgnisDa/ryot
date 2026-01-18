use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{
    SHOW_SPECIAL_SEASON_NAMES, compute_next_page, convert_date_to_year, convert_string_to_date,
};
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use enum_models::MediaSource;
use futures::{
    stream::{self, StreamExt},
    try_join,
};
use hashbag::HashBag;
use itertools::Itertools;
use media_models::{
    EntityTranslationDetails, EpisodeTranslationDetails, MetadataDetails, MetadataSearchItem,
    PartialMetadataPerson, PartialMetadataWithoutId, SeasonTranslationDetails, ShowEpisode,
    ShowSeason, ShowSpecifics,
};
use rust_decimal::dec;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TmdbService,
    models::{TmdbListResponse, TmdbMediaEntry, TmdbSeason, TmdbSeasonCredit, URL},
};

pub struct TmdbShowService(TmdbService);

impl TmdbShowService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self(TmdbService::new(ss).await?))
    }
}

#[async_trait]
impl MediaProvider for TmdbShowService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .0
            .client
            .get(format!("{}/tv/{}", URL, &identifier))
            .query(&[
                ("append_to_response", "videos"),
                ("language", &self.0.get_default_language()),
            ])
            .send()
            .await?;
        let show_data: TmdbMediaEntry = rsp.json().await?;
        let mut remote_videos = vec![];
        if let Some(vid) = show_data.videos {
            remote_videos.extend(vid.results.into_iter().map(|vid| EntityRemoteVideo {
                url: vid.key,
                source: EntityRemoteVideoSource::Youtube,
            }))
        }
        let mut image_ids = Vec::from_iter(show_data.poster_path.map(|p| self.0.get_image_url(p)));
        if let Some(u) = show_data.backdrop_path {
            image_ids.push(self.0.get_image_url(u));
        }
        let ((), suggestions) = try_join!(
            self.0.save_all_images("tv", identifier, &mut image_ids),
            self.0.get_all_suggestions("tv", identifier)
        )?;

        let seasons: Vec<TmdbSeason> = stream::iter(
            show_data
                .seasons
                .unwrap_or_default()
                .into_iter()
                .map(|s| s.season_number),
        )
        .map(|season_number| fetch_season_with_credits(season_number, identifier, &self.0))
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
            self.0.get_all_watch_providers("tv", identifier),
            self.0.get_external_identifiers("tv", identifier)
        )?;
        let title = show_data.name.unwrap();

        let remote_images = image_ids.into_iter().unique().collect();

        Ok(MetadataDetails {
            people,
            suggestions,
            watch_providers,
            title: title.clone(),
            is_nsfw: show_data.adult,
            description: show_data.overview,
            production_status: show_data.status,
            external_identifiers: Some(external_identifiers),
            original_language: self.0.get_language_name(show_data.original_language),
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
                runtime: Some(total_runtime).filter(|&v| v != 0),
                total_seasons: Some(total_seasons).filter(|&v| v != 0),
                total_episodes: Some(total_episodes).filter(|&v| v != 0),
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images =
                            Vec::from_iter(s.poster_path.map(|p| self.0.get_image_url(p)));
                        let backdrop_images =
                            Vec::from_iter(s.backdrop_path.map(|p| self.0.get_image_url(p)));
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
                                        e.still_path.map(|p| self.0.get_image_url(p)),
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
        page: u64,
        query: &str,
        display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let rsp = self
            .0
            .client
            .get(format!("{URL}/search/tv"))
            .query(&[
                ("query", query),
                ("page", &page.to_string()),
                ("language", &self.0.get_default_language()),
                ("include_adult", &display_nsfw.to_string()),
            ])
            .send()
            .await?;
        let search: TmdbListResponse = rsp.json().await?;
        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.id.to_string(),
                title: d.title.unwrap_or_default(),
                image: d.poster_path.map(|p| self.0.get_image_url(p)),
                publish_year: convert_date_to_year(&d.first_air_date.unwrap()),
            })
            .collect_vec();
        let next_page = compute_next_page(page, search.total_results);
        Ok(SearchResults {
            items: resp.to_vec(),
            details: SearchDetails {
                next_page,
                total_items: search.total_results,
            },
        })
    }

    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        self.0.get_trending_media("tv").await
    }

    async fn translate_metadata(
        &self,
        identifier: &str,
        target_language: &str,
    ) -> Result<EntityTranslationDetails> {
        let rsp = self
            .0
            .client
            .get(format!("{URL}/tv/{identifier}"))
            .query(&[("language", target_language)])
            .send()
            .await?;
        let data: TmdbMediaEntry = rsp.json().await?;
        let TmdbMediaEntry {
            name,
            seasons,
            overview,
            poster_path,
            ..
        } = data;
        let seasons = stream::iter(
            seasons
                .unwrap_or_default()
                .into_iter()
                .map(|season| season.season_number),
        )
        .map(|season_number| {
            fetch_season_with_language(season_number, identifier, &self.0, target_language)
        })
        .buffer_unordered(5)
        .collect::<Vec<Result<TmdbSeason>>>()
        .await
        .into_iter()
        .collect::<Result<Vec<TmdbSeason>>>()?
        .into_iter()
        .sorted_by_key(|s| s.season_number)
        .map(|season| {
            let episodes = season
                .episodes
                .into_iter()
                .map(|episode| EpisodeTranslationDetails {
                    name: Some(episode.name),
                    overview: episode.overview,
                    episode_number: episode.episode_number,
                })
                .collect();
            SeasonTranslationDetails {
                episodes,
                name: Some(season.name),
                overview: season.overview,
                season_number: season.season_number,
            }
        })
        .collect_vec();
        Ok(EntityTranslationDetails {
            title: name,
            description: overview,
            seasons: (!seasons.is_empty()).then_some(seasons),
            image: poster_path.map(|p| self.0.get_image_url(p)),
            ..Default::default()
        })
    }
}

pub async fn fetch_season_with_credits(
    season_number: i32,
    identifier: &str,
    base: &TmdbService,
) -> Result<TmdbSeason> {
    let season_data_future = base
        .client
        .get(format!("{URL}/tv/{identifier}/season/{season_number}"))
        .query(&[("language", &base.get_default_language())])
        .send();

    let season_credits_future = base
        .client
        .get(format!(
            "{URL}/tv/{identifier}/season/{season_number}/credits"
        ))
        .query(&[("language", &base.get_default_language())])
        .send();

    let (season_resp, credits_resp) = try_join!(season_data_future, season_credits_future)?;

    let mut season_data: TmdbSeason = season_resp.json().await?;
    let credits: TmdbSeasonCredit = credits_resp.json().await?;

    for episode in season_data.episodes.iter_mut() {
        episode.guest_stars.extend(credits.cast.clone());
    }

    Ok(season_data)
}

async fn fetch_season_with_language(
    season_number: i32,
    identifier: &str,
    base: &TmdbService,
    target_language: &str,
) -> Result<TmdbSeason> {
    let rsp = base
        .client
        .get(format!("{URL}/tv/{identifier}/season/{season_number}"))
        .query(&[("language", target_language)])
        .send()
        .await?;
    let season_data: TmdbSeason = rsp.json().await?;
    Ok(season_data)
}
