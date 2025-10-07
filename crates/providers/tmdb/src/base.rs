use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, bail};
use application_utils::get_base_http_client;
use common_utils::{convert_date_to_year, ryot_log};
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, TmdbLanguage, TmdbSettings};
use enum_models::{MediaLot, MediaSource};
use futures::{
    stream::{self, StreamExt},
    try_join,
};
use media_models::{
    MetadataExternalIdentifiers, PartialMetadataWithoutId, TmdbMetadataLookupResult, WatchProvider,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use supporting_service::SupportingService;

use crate::models::*;

pub struct TmdbService {
    pub client: Client,
    pub language: String,
    pub settings: TmdbSettings,
}

impl TmdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let access_token = &ss.config.movies_and_shows.tmdb.access_token;
        let client: Client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {access_token}"))?,
        )]));
        let settings = get_settings(&client, &ss).await.unwrap_or_default();
        Ok(Self {
            client,
            settings,
            language: ss.config.movies_and_shows.tmdb.locale.clone(),
        })
    }

    pub fn get_image_url(&self, c: String) -> String {
        format!("{}{}{}", self.settings.image_url, "original", c)
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        self.settings
            .languages
            .iter()
            .map(|l| l.iso_639_1.clone())
            .collect()
    }

    pub fn get_default_language(&self) -> String {
        "en".to_owned()
    }

    pub fn get_language_name(&self, iso: Option<String>) -> Option<String> {
        iso.and_then(|i| {
            self.settings
                .languages
                .iter()
                .find(|l| l.iso_639_1 == i)
                .map(|l| l.english_name.clone())
        })
    }

    pub async fn save_all_images(
        &self,
        media_type: &str,
        identifier: &str,
        images: &mut Vec<String>,
    ) -> Result<()> {
        let rsp = self
            .client
            .get(format!("{URL}/{media_type}/{identifier}/images"))
            .send()
            .await?;
        let new_images: TmdbImagesResponse = rsp.json().await?;
        if let Some(imgs) = new_images.posters {
            for image in imgs {
                images.push(self.get_image_url(image.file_path));
            }
        }
        if let Some(imgs) = new_images.backdrops {
            for image in imgs {
                images.push(self.get_image_url(image.file_path));
            }
        }
        if let Some(imgs) = new_images.logos {
            for image in imgs {
                images.push(self.get_image_url(image.file_path));
            }
        }
        if let Some(imgs) = new_images.profiles {
            for image in imgs {
                images.push(self.get_image_url(image.file_path));
            }
        }
        Ok(())
    }

    pub async fn get_all_suggestions(
        &self,
        media_type: &str,
        identifier: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let lot = match media_type {
            "movie" => MediaLot::Movie,
            "tv" => MediaLot::Show,
            _ => unreachable!(),
        };

        self.fetch_paginated_data(
            format!("{URL}/{media_type}/{identifier}/recommendations"),
            &[("page", "1")],
            None,
            |entry| async move {
                entry.title.map(|title| PartialMetadataWithoutId {
                    lot,
                    title,
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    image: entry.poster_path.map(|p| self.get_image_url(p)),
                    ..Default::default()
                })
            },
        )
        .await
    }

    pub async fn get_all_watch_providers(
        &self,
        media_type: &str,
        identifier: &str,
    ) -> Result<Vec<WatchProvider>> {
        let watch_providers_with_langs: TmdbWatchProviderResponse = self
            .client
            .get(format!("{URL}/{media_type}/{identifier}/watch/providers"))
            .query(&[("language", self.language.as_str())])
            .send()
            .await?
            .json()
            .await?;
        let mut watch_providers = Vec::<WatchProvider>::new();
        for (country, lang_providers) in watch_providers_with_langs.results {
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.rent,
                country.clone(),
            );
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.buy,
                country.clone(),
            );
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.flatrate,
                country.clone(),
            );
        }
        Ok(watch_providers)
    }

    fn append_to_watch_provider(
        &self,
        watch_providers: &mut Vec<WatchProvider>,
        maybe_provider: Option<Vec<TmdbWatchProviderDetails>>,
        country: String,
    ) {
        if let Some(provider) = maybe_provider {
            for provider in provider {
                let maybe_position = watch_providers
                    .iter()
                    .position(|p| p.name == provider.provider_name);
                if let Some(position) = maybe_position {
                    watch_providers[position].languages.insert(country.clone());
                } else {
                    watch_providers.push(WatchProvider {
                        name: provider.provider_name,
                        languages: HashSet::from_iter(vec![country.clone()]),
                        image: provider.logo_path.map(|i| self.get_image_url(i)),
                    });
                }
            }
        }
    }

    pub async fn get_external_identifiers(
        &self,
        media_type: &str,
        identifier: &str,
    ) -> Result<MetadataExternalIdentifiers> {
        let rsp = self
            .client
            .get(format!("{URL}/{media_type}/{identifier}/external_ids"))
            .send()
            .await?;
        Ok(rsp.json().await?)
    }

    pub async fn fetch_paginated_data<T, F, Fut>(
        &self,
        url: String,
        query_params: &[(&str, &str)],
        max_pages: Option<u64>,
        process_entry: F,
    ) -> Result<Vec<T>>
    where
        F: Fn(TmdbEntry) -> Fut + Send + Sync + Clone,
        Fut: Future<Output = Option<T>> + Send,
        T: Send,
    {
        let first_page: TmdbListResponse = self
            .client
            .get(&url)
            .query(query_params)
            .send()
            .await?
            .json()
            .await?;

        let total_pages = match max_pages {
            Some(max) => first_page.total_pages.min(max),
            None => first_page.total_pages,
        };

        let mut results = vec![];
        for entry in first_page.results {
            if let Some(processed) = process_entry(entry).await {
                results.push(processed);
            }
        }

        if total_pages > 1 {
            let remaining_pages: Vec<Result<Vec<T>>> = stream::iter(2..=total_pages)
                .map(|page| {
                    let client = &self.client;
                    let url = &url;
                    let process_entry = process_entry.clone();
                    async move {
                        let mut page_query = query_params.to_vec();
                        let page_str = page.to_string();
                        // Update or add the page parameter
                        if let Some(pos) = page_query.iter().position(|(k, _)| *k == "page") {
                            page_query[pos] = ("page", page_str.as_str());
                        } else {
                            page_query.push(("page", page_str.as_str()));
                        }

                        let page_response: TmdbListResponse = client
                            .get(url)
                            .query(&page_query)
                            .send()
                            .await?
                            .json()
                            .await?;

                        let mut page_results = vec![];
                        for entry in page_response.results {
                            if let Some(processed) = process_entry(entry).await {
                                page_results.push(processed);
                            }
                        }
                        Ok(page_results)
                    }
                })
                .buffer_unordered(5)
                .collect()
                .await;

            for page_result in remaining_pages {
                results.extend(page_result?);
            }
        }

        Ok(results)
    }

    pub async fn get_trending_media(
        &self,
        media_type: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let media_lot = match media_type {
            "movie" => MediaLot::Movie,
            "tv" => MediaLot::Show,
            _ => bail!("Invalid media type"),
        };

        self.fetch_paginated_data(
            format!("{URL}/trending/{media_type}/day"),
            &[("page", "1"), ("language", self.language.as_str())],
            Some(3),
            |entry| async move {
                entry.title.map(|title| PartialMetadataWithoutId {
                    title,
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    image: entry.poster_path.map(|p| self.get_image_url(p)),
                    lot: media_lot,
                    ..Default::default()
                })
            },
        )
        .await
    }

    pub async fn multi_search(&self, query: &str) -> Result<Vec<TmdbMetadataLookupResult>> {
        ryot_log!(debug, "tmdb multi_search: query={}", query);
        let response: TmdbListResponse = self
            .client
            .get(format!("{URL}/search/multi"))
            .query(&[
                ("page", "1"),
                ("query", query),
                ("language", self.language.as_str()),
            ])
            .send()
            .await?
            .json()
            .await?;

        let results = response
            .results
            .into_iter()
            .filter_map(|entry| {
                let media_type = entry.media_type.as_deref()?;
                let lot = match media_type {
                    "tv" => MediaLot::Show,
                    "movie" => MediaLot::Movie,
                    _ => return None,
                };
                Some(TmdbMetadataLookupResult {
                    lot,
                    identifier: entry.id.to_string(),
                    title: entry.title.unwrap_or_default(),
                    publish_year: entry.release_date.and_then(|r| convert_date_to_year(&r)),
                })
            })
            .collect();

        Ok(results)
    }
}

async fn get_settings(client: &Client, ss: &Arc<SupportingService>) -> Result<TmdbSettings> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::TmdbSettings,
        ApplicationCacheValue::TmdbSettings,
        || async {
            let config_future = client.get(format!("{URL}/configuration")).send();
            let languages_future = client.get(format!("{URL}/configuration/languages")).send();
            let (config_resp, languages_resp) = try_join!(config_future, languages_future)?;
            let configuration: TmdbConfiguration = config_resp.json().await?;
            let languages: Vec<TmdbLanguage> = languages_resp.json().await?;
            let settings = TmdbSettings {
                languages,
                image_url: configuration.images.secure_base_url,
            };
            Ok(settings)
        },
    )
    .await
    .map(|c| c.response)
}
