use std::sync::Arc;

use async_graphql::Result;
use common_models::{
    MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput, UserLevelCacheKey,
};
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, MetadataGroupSearchResponse,
    MetadataSearchResponse, PeopleSearchResponse, SearchResults,
};
use dependent_utils::{
    commit_metadata, commit_metadata_group, commit_person, get_metadata_provider,
    get_non_metadata_provider,
};
use futures::future::try_join_all;
use itertools::Itertools;
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, PartialMetadataWithoutId, UniqueMediaIdentifier,
};
use supporting_service::SupportingService;

pub async fn metadata_search(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: MetadataSearchInput,
) -> Result<MetadataSearchResponse> {
    let cache_key = ApplicationCacheKey::MetadataSearch(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (_id, response) = ss
        .cache_service
        .get_or_set_with_callback(cache_key, ApplicationCacheValue::MetadataSearch, || async {
            let query = input.search.query.unwrap_or_default();
            if query.is_empty() {
                return Ok(SearchResults::default());
            }
            let preferences = user_by_id(user_id, ss).await?.preferences;
            let provider = get_metadata_provider(input.lot, input.source, ss).await?;
            let results = provider
                .metadata_search(
                    &query,
                    input.search.page,
                    preferences.general.display_nsfw,
                    &input.source_specifics,
                )
                .await?;
            let promises = results.items.iter().map(|i| {
                commit_metadata(
                    PartialMetadataWithoutId {
                        lot: input.lot,
                        source: input.source,
                        title: i.title.clone(),
                        image: i.image.clone(),
                        publish_year: i.publish_year,
                        identifier: i.identifier.clone(),
                    },
                    ss,
                    None,
                )
            });
            let metadata_items = try_join_all(promises)
                .await?
                .into_iter()
                .map(|(metadata, _)| metadata.id)
                .collect_vec();
            let response = SearchResults {
                items: metadata_items,
                details: results.details,
            };
            Ok(response)
        })
        .await?;

    Ok(response)
}

pub async fn people_search(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: PeopleSearchInput,
) -> Result<PeopleSearchResponse> {
    let cache_key = ApplicationCacheKey::PeopleSearch(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.clone(),
    });

    let (_id, response) = ss
        .cache_service
        .get_or_set_with_callback(cache_key, ApplicationCacheValue::PeopleSearch, || async {
            let query = input.search.query.unwrap_or_default();
            if query.is_empty() {
                return Ok(SearchResults::default());
            }
            let preferences = user_by_id(user_id, ss).await?.preferences;
            let provider = get_non_metadata_provider(input.source, ss).await?;
            let results = provider
                .people_search(
                    &query,
                    input.search.page,
                    preferences.general.display_nsfw,
                    &input.source_specifics,
                )
                .await?;
            let promises = results.items.iter().map(|i| {
                commit_person(
                    CommitPersonInput {
                        name: i.name.clone(),
                        source: input.source,
                        image: i.image.clone(),
                        identifier: i.identifier.clone(),
                        source_specifics: input.source_specifics.clone(),
                    },
                    ss,
                )
            });
            let person_items = try_join_all(promises)
                .await?
                .into_iter()
                .map(|i| i.id)
                .collect_vec();
            let response = SearchResults {
                items: person_items,
                details: results.details,
            };
            Ok(response)
        })
        .await?;

    Ok(response)
}

pub async fn metadata_group_search(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: MetadataGroupSearchInput,
) -> Result<MetadataGroupSearchResponse> {
    let cache_key = ApplicationCacheKey::MetadataGroupSearch(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.clone(),
    });

    let (_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            cache_key,
            ApplicationCacheValue::MetadataGroupSearch,
            || async {
                let query = input.search.query.unwrap_or_default();
                if query.is_empty() {
                    return Ok(SearchResults::default());
                }
                let preferences = user_by_id(user_id, ss).await?.preferences;
                let provider = get_metadata_provider(input.lot, input.source, ss).await?;
                let results = provider
                    .metadata_group_search(
                        &query,
                        input.search.page,
                        preferences.general.display_nsfw,
                    )
                    .await?;
                let promises = results.items.iter().map(|i| {
                    commit_metadata_group(
                        CommitMetadataGroupInput {
                            parts: i.parts,
                            name: i.name.clone(),
                            image: i.image.clone(),
                            unique: UniqueMediaIdentifier {
                                lot: input.lot,
                                source: input.source,
                                identifier: i.identifier.clone(),
                            },
                        },
                        ss,
                    )
                });
                let metadata_group_items = try_join_all(promises)
                    .await?
                    .into_iter()
                    .map(|i| i.id)
                    .collect_vec();
                let response = SearchResults {
                    details: results.details,
                    items: metadata_group_items,
                };
                Ok(response)
            },
        )
        .await?;

    Ok(response)
}
