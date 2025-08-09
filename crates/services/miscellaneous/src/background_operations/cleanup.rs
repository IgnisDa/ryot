use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_utils::{BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE, ryot_log};
use database_models::{
    access_link, application_cache, genre, metadata, metadata_group, metadata_to_genre, person,
    prelude::{
        AccessLink, ApplicationCache, Genre, Metadata, MetadataGroup, MetadataToGenre, Person,
        UserToEntity,
    },
    user_to_entity,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect, UpdateMany};
use sea_query::Expr;
use supporting_service::SupportingService;
use traits::TraceOk;

pub async fn remove_useless_data(ss: &Arc<SupportingService>) -> Result<()> {
    let metadata_to_delete = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::MetadataId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in metadata_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} metadata items", chunk.len());
        Metadata::delete_many()
            .filter(metadata::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    let people_to_delete = Person::find()
        .select_only()
        .column(person::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::PersonId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in people_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} people", chunk.len());
        Person::delete_many()
            .filter(person::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    let metadata_groups_to_delete = MetadataGroup::find()
        .select_only()
        .column(metadata_group::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::MetadataGroupId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in metadata_groups_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} metadata groups", chunk.len());
        MetadataGroup::delete_many()
            .filter(metadata_group::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    let genre_to_delete = Genre::find()
        .select_only()
        .column(genre::Column::Id)
        .left_join(MetadataToGenre)
        .filter(metadata_to_genre::Column::MetadataId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in genre_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} genres", chunk.len());
        Genre::delete_many()
            .filter(genre::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    ryot_log!(debug, "Deleting revoked access tokens");
    AccessLink::delete_many()
        .filter(access_link::Column::IsRevoked.eq(true))
        .exec(&ss.db)
        .await
        .trace_ok();
    ryot_log!(debug, "Deleting expired application caches");
    ApplicationCache::delete_many()
        .filter(application_cache::Column::ExpiresAt.lt(Utc::now()))
        .exec(&ss.db)
        .await
        .trace_ok();
    Ok(())
}

pub async fn put_entities_in_partial_state(ss: &Arc<SupportingService>) -> Result<()> {
    async fn update_partial_states<Column1, Column2, Column3, T>(
        ute_filter_column: Column1,
        updater: UpdateMany<T>,
        entity_id_column: Column2,
        entity_update_column: Column3,
        db: &sea_orm::DatabaseConnection,
    ) -> Result<()>
    where
        Column1: ColumnTrait,
        Column2: ColumnTrait,
        Column3: ColumnTrait,
        T: EntityTrait,
    {
        let ids_to_update = UserToEntity::find()
            .select_only()
            .column(ute_filter_column)
            .filter(ute_filter_column.is_not_null())
            .into_tuple::<String>()
            .all(db)
            .await?;
        for chunk in ids_to_update.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
            ryot_log!(debug, "Entities to update: {:?}", chunk);
            updater
                .clone()
                .col_expr(entity_update_column, Expr::value(true))
                .filter(entity_id_column.is_in(chunk))
                .exec(db)
                .await?;
        }
        Ok(())
    }
    update_partial_states(
        user_to_entity::Column::MetadataId,
        Metadata::update_many(),
        metadata::Column::Id,
        metadata::Column::IsPartial,
        &ss.db,
    )
    .await?;
    update_partial_states(
        user_to_entity::Column::MetadataGroupId,
        MetadataGroup::update_many(),
        metadata_group::Column::Id,
        metadata_group::Column::IsPartial,
        &ss.db,
    )
    .await?;
    update_partial_states(
        user_to_entity::Column::PersonId,
        Person::update_many(),
        person::Column::Id,
        person::Column::IsPartial,
        &ss.db,
    )
    .await?;
    Ok(())
}
