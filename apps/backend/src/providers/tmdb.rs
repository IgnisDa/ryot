use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use hashbag::HashBag;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::{MoviesTmdbConfig, ShowsTmdbConfig},
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator, MetadataImage,
            MetadataImageUrl, MovieSpecifics, ShowEpisode, ShowSeason, ShowSpecifics,
        },
        NamedObject, SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, convert_string_to_date},
};

pub static URL: &str = "https://api.themoviedb.org/3/";

#[derive(Debug, Clone)]
pub struct TmdbService {
    image_url: String,
    language: String,
}

impl TmdbService {
    fn get_cover_image_url(&self, c: String) -> String {
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
    pub async fn new(config: &MoviesTmdbConfig, _page_limit: i32) -> Self {
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
            status: Option<String>,
            genres: Vec<NamedObject>,
            production_companies: Option<Vec<utils::TmdbCompany>>,
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
        let mut creators = vec![];
        creators.extend(
            credits
                .cast
                .clone()
                .into_iter()
                .flat_map(|g| {
                    if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                        if r == *"Acting" {
                            Some(MetadataCreator {
                                name: n,
                                role: r,
                                image: g.profile_path,
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .unique()
                .collect_vec(),
        );
        creators.extend(
            credits
                .crew
                .clone()
                .into_iter()
                .flat_map(|g| {
                    if let (Some(n), Some(r)) = (g.name, g.job) {
                        if r == *"Director" {
                            Some(MetadataCreator {
                                name: n,
                                role: r,
                                image: g.profile_path,
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .unique()
                .collect_vec(),
        );
        creators.extend(
            data.production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| MetadataCreator {
                    name: p.name,
                    role: "Production".to_owned(),
                    image: p.logo_path.map(|p| self.base.get_cover_image_url(p)),
                })
                .collect_vec(),
        );
        let creators = creators
            .into_iter()
            .map(|c| MetadataCreator {
                name: c.name,
                role: c.role,
                image: c.image.map(|i| self.base.get_cover_image_url(i)),
            })
            .collect_vec();
        let mut image_ids = Vec::from_iter(data.poster_path);
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        utils::save_all_images(&self.client, "movie", identifier, &mut image_ids).await?;

        Ok(MediaDetails {
            identifier: data.id.to_string(),
            lot: MetadataLot::Movie,
            source: MetadataSource::Tmdb,
            production_status: data.status.unwrap_or_else(|| "Released".to_owned()),
            title: data.title,
            genres: data.genres.into_iter().map(|g| g.name).collect(),
            creators,
            images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImage {
                    url: MetadataImageUrl::Url(self.base.get_cover_image_url(p)),
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

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
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
            .map(|d| MediaSearchItem {
                identifier: d.id.to_string(),
                title: d.title,
                publish_year: convert_date_to_year(&d.release_date),
                image: d.poster_path.map(|p| self.base.get_cover_image_url(p)),
            })
            .collect_vec();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_results,
                next_page,
            },
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
    pub async fn new(config: &ShowsTmdbConfig, _page_limit: i32) -> Self {
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
            status: Option<String>,
            production_companies: Option<Vec<utils::TmdbCompany>>,
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
        let show_data: TmdbShow = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut image_ids = Vec::from_iter(show_data.poster_path);
        if let Some(u) = show_data.backdrop_path {
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
        for s in show_data.seasons.iter() {
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
            let mut data: TmdbSeason = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            let mut rsp = self
                .client
                .get(format!(
                    "tv/{}/season/{}/credits",
                    identifier.to_owned(),
                    s.season_number
                ))
                .query(&json!({
                    "language": self.base.language,
                }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?;
            #[derive(Debug, Serialize, Deserialize, Clone)]
            struct TmdbSeasonCredit {
                cast: Vec<utils::TmdbCredit>,
            }
            let credits: TmdbSeasonCredit = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            for e in data.episodes.iter_mut() {
                e.guest_stars.extend(credits.cast.clone());
            }
            seasons.push(data);
        }
        let mut author_names = seasons
            .iter()
            .flat_map(|s| {
                s.episodes
                    .iter()
                    .flat_map(|e| {
                        e.guest_stars
                            .clone()
                            .into_iter()
                            .flat_map(|g| {
                                if let (Some(n), Some(r)) = (g.name, g.known_for_department) {
                                    Some(MetadataCreator {
                                        name: n,
                                        role: r,
                                        image: g
                                            .profile_path
                                            .map(|p| self.base.get_cover_image_url(p)),
                                    })
                                } else {
                                    None
                                }
                            })
                            .collect_vec()
                    })
                    .collect_vec()
            })
            .collect_vec();
        author_names.extend(
            show_data
                .production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| MetadataCreator {
                    name: p.name,
                    role: "Production".to_owned(),
                    image: p.logo_path.map(|p| self.base.get_cover_image_url(p)),
                }),
        );
        let author_names: HashBag<MetadataCreator> = HashBag::from_iter(author_names.into_iter());
        let author_names = Vec::from_iter(author_names.set_iter())
            .into_iter()
            .sorted_by_key(|c| c.1)
            .rev()
            .map(|c| c.0)
            .filter(|c| ["Acting", "Production", "Directing"].contains(&c.role.as_str()))
            .cloned()
            .collect_vec();
        Ok(MediaDetails {
            identifier: show_data.id.to_string(),
            title: show_data.name,
            lot: MetadataLot::Show,
            production_status: show_data.status.unwrap_or_else(|| "Released".to_owned()),
            source: MetadataSource::Tmdb,
            description: show_data.overview,
            creators: author_names,
            genres: show_data
                .genres
                .into_iter()
                .map(|g| g.name)
                .unique()
                .collect(),
            publish_date: convert_string_to_date(
                &show_data.first_air_date.clone().unwrap_or_default(),
            ),
            images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImage {
                    url: MetadataImageUrl::Url(self.base.get_cover_image_url(p)),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_year: convert_date_to_year(&show_data.first_air_date.unwrap_or_default()),
            specifics: MediaSpecifics::Show(ShowSpecifics {
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images =
                            Vec::from_iter(s.poster_path.map(|p| self.base.get_cover_image_url(p)));
                        let backdrop_images = Vec::from_iter(
                            s.backdrop_path.map(|p| self.base.get_cover_image_url(p)),
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
                                        e.still_path.map(|p| self.base.get_cover_image_url(p)),
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

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
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
            .map(|d| MediaSearchItem {
                identifier: d.id.to_string(),
                title: d.name,
                publish_year: convert_date_to_year(&d.first_air_date),
                image: d.poster_path.map(|p| self.base.get_cover_image_url(p)),
            })
            .collect_vec();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_results,
                next_page,
            },
            items: resp.to_vec(),
        })
    }
}

mod utils {
    use std::{env, fs};

    use surf::http::headers::AUTHORIZATION;

    use crate::utils::{get_base_http_client, read_file_to_json};

    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbCompany {
        pub name: String,
        pub logo_path: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbCredit {
        pub name: Option<String>,
        pub known_for_department: Option<String>,
        pub job: Option<String>,
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
        let client: Client =
            get_base_http_client(url, vec![(AUTHORIZATION, format!("Bearer {access_token}"))]);
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
