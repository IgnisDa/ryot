use std::{cmp::Reverse, collections::HashMap, sync::Arc};

use anyhow::{Result, anyhow};
use common_models::{SearchDetails, UserLevelCacheKey};
use database_models::{
    metadata_group_to_person, metadata_to_genre, metadata_to_metadata_group, metadata_to_person,
    prelude::{
        Genre, MetadataGroup, MetadataGroupToPerson, MetadataToGenre, MetadataToMetadataGroup,
        MetadataToPerson, Person,
    },
};
use database_utils::{extract_pagination_params, transform_entity_assets};
use dependent_entity_utils::generic_metadata;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, GenreDetails, GraphqlPersonDetails,
    MetadataBaseData, MetadataGroupDetails, SearchResults,
};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use media_models::{
    GenreDetailsInput, GenreListItem, GraphqlMetadataDetails, GraphqlMetadataGroup,
    PersonDetailsGroupedByRole, PersonDetailsItemWithCharacter,
};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use supporting_service::SupportingService;

pub async fn person_details(
    person_id: String,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<GraphqlPersonDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::PersonDetails(person_id.clone()),
        |f| ApplicationCacheValue::PersonDetails(Box::new(f)),
        || async {
            let mut details = Person::find_by_id(person_id.clone())
                .one(&ss.db)
                .await?
                .unwrap();
            transform_entity_assets(&mut details.assets, ss).await?;
            let metadata_associations = MetadataToPerson::find()
                .filter(metadata_to_person::Column::PersonId.eq(&person_id))
                .order_by_asc(metadata_to_person::Column::Index)
                .all(&ss.db)
                .await?;
            let mut metadata_contents: HashMap<_, Vec<_>> = HashMap::new();
            for assoc in metadata_associations {
                let to_push = PersonDetailsItemWithCharacter {
                    character: assoc.character,
                    entity_id: assoc.metadata_id,
                };
                metadata_contents
                    .entry(assoc.role)
                    .and_modify(|e| e.push(to_push.clone()))
                    .or_insert(vec![to_push]);
            }
            let associated_metadata = metadata_contents
                .into_iter()
                .map(|(name, items)| PersonDetailsGroupedByRole { name, items })
                .sorted_by_key(|f| Reverse(f.items.len()))
                .collect_vec();
            let associated_metadata_groups = MetadataGroupToPerson::find()
                .filter(metadata_group_to_person::Column::PersonId.eq(person_id))
                .order_by_asc(metadata_group_to_person::Column::Index)
                .all(&ss.db)
                .await?;
            let mut metadata_group_contents: HashMap<_, Vec<_>> = HashMap::new();
            for assoc in associated_metadata_groups {
                let to_push = PersonDetailsItemWithCharacter {
                    entity_id: assoc.metadata_group_id,
                    ..Default::default()
                };
                metadata_group_contents
                    .entry(assoc.role)
                    .and_modify(|e| e.push(to_push.clone()))
                    .or_insert(vec![to_push]);
            }
            let associated_metadata_groups = metadata_group_contents
                .into_iter()
                .map(|(name, items)| PersonDetailsGroupedByRole { name, items })
                .sorted_by_key(|f| Reverse(f.items.len()))
                .collect_vec();
            Ok(GraphqlPersonDetails {
                details,
                associated_metadata,
                associated_metadata_groups,
            })
        },
    )
    .await
}

pub async fn genre_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: GenreDetailsInput,
) -> Result<CachedResponse<GenreDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::GenreDetails(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::GenreDetails,
        || async {
            let (take, page) = extract_pagination_params(input.search, &user_id, ss).await?;
            let genre = Genre::find_by_id(input.genre_id.clone())
                .one(&ss.db)
                .await?
                .unwrap();
            let paginator = MetadataToGenre::find()
                .filter(metadata_to_genre::Column::GenreId.eq(input.genre_id))
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let mut contents = vec![];
            for association_items in paginator.fetch_page(page - 1).await? {
                contents.push(association_items.metadata_id);
            }
            Ok(GenreDetails {
                details: GenreListItem {
                    id: genre.id,
                    name: genre.name,
                    num_items: Some(number_of_items.try_into().unwrap()),
                },
                contents: SearchResults {
                    items: contents,
                    details: SearchDetails {
                        total_items: number_of_items,
                        next_page: (page < number_of_pages).then(|| page + 1),
                    },
                },
            })
        },
    )
    .await
}

pub async fn metadata_group_details(
    ss: &Arc<SupportingService>,
    metadata_group_id: String,
) -> Result<CachedResponse<MetadataGroupDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::MetadataGroupDetails(metadata_group_id.to_owned()),
        |f| ApplicationCacheValue::MetadataGroupDetails(Box::new(f)),
        || async {
            let mut details = MetadataGroup::find_by_id(&metadata_group_id)
                .one(&ss.db)
                .await?
                .unwrap();
            transform_entity_assets(&mut details.assets, ss).await?;
            let contents = MetadataToMetadataGroup::find()
                .select_only()
                .column(metadata_to_metadata_group::Column::MetadataId)
                .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(metadata_group_id))
                .order_by_asc(metadata_to_metadata_group::Column::Part)
                .into_tuple::<String>()
                .all(&ss.db)
                .await?;
            Ok(MetadataGroupDetails { details, contents })
        },
    )
    .await
}

pub async fn metadata_details(
    ss: &Arc<SupportingService>,
    metadata_id: &String,
) -> Result<CachedResponse<GraphqlMetadataDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::MetadataDetails(metadata_id.to_owned()),
        |f| ApplicationCacheValue::MetadataDetails(Box::new(f)),
        || async {
            let (
                MetadataBaseData {
                    model,
                    genres,
                    creators,
                    suggestions,
                },
                associations,
            ) = try_join!(
                generic_metadata(metadata_id, ss, None),
                MetadataToMetadataGroup::find()
                    .filter(metadata_to_metadata_group::Column::MetadataId.eq(metadata_id))
                    .find_also_related(MetadataGroup)
                    .all(&ss.db)
                    .map_err(|_| anyhow!("Failed to fetch metadata associations"))
            )?;

            let mut groups = vec![];
            for association in associations {
                let grp = association.1.unwrap();
                groups.push(GraphqlMetadataGroup {
                    id: grp.id,
                    part: association.0.part,
                });
            }

            let watch_providers = model.watch_providers.unwrap_or_default();

            let resp = GraphqlMetadataDetails {
                groups,
                genres,
                creators,
                suggestions,
                id: model.id,
                lot: model.lot,
                watch_providers,
                title: model.title,
                assets: model.assets,
                source: model.source,
                is_nsfw: model.is_nsfw,
                source_url: model.source_url,
                is_partial: model.is_partial,
                identifier: model.identifier,
                description: model.description,
                publish_date: model.publish_date,
                publish_year: model.publish_year,
                book_specifics: model.book_specifics,
                show_specifics: model.show_specifics,
                movie_specifics: model.movie_specifics,
                music_specifics: model.music_specifics,
                manga_specifics: model.manga_specifics,
                anime_specifics: model.anime_specifics,
                provider_rating: model.provider_rating,
                production_status: model.production_status,
                original_language: model.original_language,
                podcast_specifics: model.podcast_specifics,
                created_by_user_id: model.created_by_user_id,
                video_game_specifics: model.video_game_specifics,
                audio_book_specifics: model.audio_book_specifics,
                visual_novel_specifics: model.visual_novel_specifics,
            };
            Ok(resp)
        },
    )
    .await
}
