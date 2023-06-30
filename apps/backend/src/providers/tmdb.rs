use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::{MoviesTmdbConfig, ShowsTmdbConfig},
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl,
    },
    models::media::{MovieSpecifics, ShowEpisode, ShowSeason, ShowSpecifics},
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, convert_string_to_date, NamedObject},
};

pub static URL: &str = "https://api.themoviedb.org/3/";

#[derive(Debug, Clone)]
pub struct TmdbService {
    image_url: String,
    language: String,
}

impl TmdbService {
    fn get_cover_image_url(&self, c: &str) -> String {
        format!("{}{}{}", self.image_url, "original", c)
    }
}

impl MediaProviderLanguages for TmdbService {
    fn supported_languages() -> Vec<String> {
        isolang::languages()
            .filter_map(|l| l.to_639_1().map(String::from))
            .collect()
    }

    fn default_language() -> String {
        "en".to_owned()
    }
}

#[derive(Debug, Clone)]
pub struct TmdbMovieService {
    client: Client,
    base: TmdbService,
}

impl TmdbMovieService {
    pub async fn new(config: &MoviesTmdbConfig) -> Self {
        let (client, image_url) = utils::get_client_config(URL, &config.access_token).await;
        Self {
            client,
            base: TmdbService {
                image_url,
                language: config.locale.clone(),
            },
        }
    }
}

#[async_trait]
impl MediaProvider for TmdbMovieService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            release_date: String,
            runtime: i32,
            genres: Vec<NamedObject>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", &identifier))
            .query(&json!({
                "language": self.base.language,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbCreditsResponse {
            cast: Vec<utils::TmdbCredit>,
            crew: Vec<utils::TmdbCredit>,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}/credits", identifier))
            .query(&json!({
                "language": self.base.language,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let credits: TmdbCreditsResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut all_creators = credits
            .cast
            .clone()
            .into_iter()
            .flat_map(|g| {
                if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                    Some(MetadataCreator {
                        name: n,
                        role: r,
                        image_urls: Vec::from_iter(
                            g.profile_path.map(|p| self.base.get_cover_image_url(&p)),
                        ),
                    })
                } else {
                    None
                }
            })
            .unique()
            .collect::<Vec<_>>();
        all_creators.extend(credits.crew.into_iter().flat_map(|g| {
            if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                Some(MetadataCreator {
                    name: n,
                    role: r,
                    image_urls: Vec::from_iter(
                        g.profile_path.map(|p| self.base.get_cover_image_url(&p)),
                    ),
                })
            } else {
                None
            }
        }));
        let mut image_ids = Vec::from_iter(data.poster_path);
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        utils::save_all_images(&self.client, "movie", identifier, &mut image_ids).await?;

        Ok(MediaDetails {
            identifier: data.id.to_string(),
            lot: MetadataLot::Movie,
            source: MetadataSource::Tmdb,
            title: data.title,
            genres: data.genres.into_iter().map(|g| g.name).collect(),
            creators: Vec::from_iter(all_creators),
            images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImage {
                    url: MetadataImageUrl::Url(self.base.get_cover_image_url(&p)),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_year: convert_date_to_year(&data.release_date),
            publish_date: convert_string_to_date(&data.release_date),
            description: Some(data.overview),
            specifics: MediaSpecifics::Movie(MovieSpecifics {
                runtime: Some(data.runtime),
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbMovie {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            title: String,
            release_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbMovie>,
            total_pages: i32,
        }
        let mut rsp = self
            .client
            .get("search/movie")
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let images =
                    Vec::from_iter(d.poster_path.map(|p| self.base.get_cover_image_url(&p)));
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    lot: MetadataLot::Movie,
                    title: d.title,
                    publish_year: convert_date_to_year(&d.release_date),
                    images,
                }
            })
            .collect::<Vec<_>>();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(MediaSearchResults {
            total: search.total_results,
            next_page,
            items: resp.to_vec(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct TmdbShowService {
    client: Client,
    base: TmdbService,
}

impl TmdbShowService {
    pub async fn new(config: &ShowsTmdbConfig) -> Self {
        let (client, image_url) = utils::get_client_config(URL, &config.access_token).await;
        Self {
            client,
            base: TmdbService {
                image_url,
                language: config.locale.clone(),
            },
        }
    }
}

#[async_trait]
impl MediaProvider for TmdbShowService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeasonNumber {
            season_number: i32,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbShow {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            first_air_date: Option<String>,
            seasons: Vec<TmdbSeasonNumber>,
            genres: Vec<NamedObject>,
        }
        let mut rsp = self
            .client
            .get(format!("tv/{}", &identifier))
            .query(&json!({
                "language": self.base.language,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbShow = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut image_ids = Vec::from_iter(data.poster_path);
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        utils::save_all_images(&self.client, "tv", identifier, &mut image_ids).await?;

        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbEpisode {
            id: i32,
            name: String,
            episode_number: i32,
            still_path: Option<String>,
            overview: Option<String>,
            air_date: Option<String>,
            runtime: Option<i32>,
            guest_stars: Vec<utils::TmdbCredit>,
            crew: Vec<utils::TmdbCredit>,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeason {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            air_date: Option<String>,
            season_number: i32,
            episodes: Vec<TmdbEpisode>,
        }
        let mut seasons = vec![];
        for s in data.seasons.iter() {
            let mut rsp = self
                .client
                .get(format!(
                    "tv/{}/season/{}",
                    identifier.to_owned(),
                    s.season_number
                ))
                .query(&json!({
                    "language": self.base.language,
                }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?;
            let data: TmdbSeason = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            seasons.push(data);
        }
        let author_names = seasons
            .iter()
            .flat_map(|s| {
                s.episodes
                    .iter()
                    .flat_map(|e| {
                        let mut gs = e
                            .guest_stars
                            .clone()
                            .into_iter()
                            .flat_map(|g| {
                                if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                                    Some(MetadataCreator {
                                        name: n,
                                        role: r,
                                        image_urls: Vec::from_iter(
                                            g.profile_path
                                                .map(|p| self.base.get_cover_image_url(&p)),
                                        ),
                                    })
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>();
                        let crew = e
                            .crew
                            .clone()
                            .into_iter()
                            .flat_map(|g| {
                                if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                                    Some(MetadataCreator {
                                        name: n,
                                        role: r,
                                        image_urls: Vec::from_iter(
                                            g.profile_path
                                                .map(|p| self.base.get_cover_image_url(&p)),
                                        ),
                                    })
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>();
                        gs.extend(crew);
                        Vec::from_iter(gs)
                    })
                    .collect::<Vec<_>>()
            })
            .unique()
            .collect::<Vec<_>>();
        Ok(MediaDetails {
            identifier: data.id.to_string(),
            title: data.name,
            lot: MetadataLot::Show,
            source: MetadataSource::Tmdb,
            description: data.overview,
            creators: author_names,
            genres: data.genres.into_iter().map(|g| g.name).unique().collect(),
            publish_date: convert_string_to_date(&data.first_air_date.clone().unwrap_or_default()),
            images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImage {
                    url: MetadataImageUrl::Url(self.base.get_cover_image_url(&p)),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_year: convert_date_to_year(&data.first_air_date.unwrap_or_default()),
            specifics: MediaSpecifics::Show(ShowSpecifics {
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images = Vec::from_iter(
                            s.poster_path.map(|p| self.base.get_cover_image_url(&p)),
                        );
                        let backdrop_images = Vec::from_iter(
                            s.backdrop_path.map(|p| self.base.get_cover_image_url(&p)),
                        );
                        ShowSeason {
                            id: s.id,
                            name: s.name,
                            publish_date: convert_string_to_date(&s.air_date.unwrap_or_default()),
                            overview: s.overview,
                            poster_images,
                            backdrop_images,
                            season_number: s.season_number,
                            episodes: s
                                .episodes
                                .into_iter()
                                .map(|e| {
                                    let poster_images = Vec::from_iter(
                                        e.still_path.map(|p| self.base.get_cover_image_url(&p)),
                                    );
                                    ShowEpisode {
                                        id: e.id,
                                        name: e.name,
                                        runtime: e.runtime,
                                        publish_date: convert_string_to_date(
                                            &e.air_date.unwrap_or_default(),
                                        ),
                                        overview: e.overview,
                                        episode_number: e.episode_number,
                                        poster_images,
                                    }
                                })
                                .collect(),
                        }
                    })
                    .collect(),
            }),
        })
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        #[derive(Debug, Serialize, Deserialize, SimpleObject)]
        pub struct TmdbShow {
            id: i32,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            overview: Option<String>,
            name: String,
            first_air_date: String,
        }
        #[derive(Serialize, Deserialize, Debug)]
        struct TmdbSearchResponse {
            total_results: i32,
            results: Vec<TmdbShow>,
            total_pages: i32,
        }
        let mut rsp = self
            .client
            .get("search/tv")
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| {
                let images =
                    Vec::from_iter(d.poster_path.map(|p| self.base.get_cover_image_url(&p)));
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    lot: MetadataLot::Show,
                    title: d.name,
                    publish_year: convert_date_to_year(&d.first_air_date),
                    images,
                }
            })
            .collect::<Vec<_>>();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(MediaSearchResults {
            total: search.total_results,
            next_page,
            items: resp.to_vec(),
        })
    }
}

mod utils {
    use std::{env, fs};

    use surf::{
        http::headers::{AUTHORIZATION, USER_AGENT},
        Config, Url,
    };

    use crate::{graphql::USER_AGENT_STR, utils::read_file_to_json};

    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbCredit {
        pub name: Option<String>,
        pub known_for_department: Option<String>,
        pub profile_path: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbImage {
        pub file_path: String,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbImagesResponse {
        pub backdrops: Option<Vec<utils::TmdbImage>>,
        pub posters: Option<Vec<utils::TmdbImage>>,
    }

    pub async fn get_client_config(url: &str, access_token: &str) -> (Client, String) {
        let path = env::temp_dir().join("tmdb-config.json");
        let client: Client = Config::new()
            .add_header(USER_AGENT, USER_AGENT_STR)
            .unwrap()
            .add_header(AUTHORIZATION, format!("Bearer {access_token}"))
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbImageConfiguration {
            secure_base_url: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbConfiguration {
            images: TmdbImageConfiguration,
        }
        let image_url = if let Some(details) = read_file_to_json::<TmdbConfiguration>(&path) {
            details.images.secure_base_url
        } else {
            let mut rsp = client.get("configuration").await.unwrap();
            let data: TmdbConfiguration = rsp.body_json().await.unwrap();
            fs::write(path, serde_json::to_string(&data).unwrap()).ok();
            data.images.secure_base_url
        };
        (client, image_url)
    }

    pub async fn save_all_images(
        client: &Client,
        typ: &str,
        identifier: &str,
        images: &mut Vec<String>,
    ) -> Result<()> {
        let mut rsp = client
            .get(format!("{}/{}/images", typ, identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let new_images: TmdbImagesResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        if let Some(imgs) = new_images.posters {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.backdrops {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        Ok(())
    }
}
