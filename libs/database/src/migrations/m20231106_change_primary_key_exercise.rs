use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("exercise", "name").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
            r#"
alter table collection_to_entity add column exercise_name varchar;
update collection_to_entity cte set exercise_name = e.name
from exercise e where cte.exercise_id = e.id;
drop index collection_to_entity_uqi4; 
create unique index collection_to_entity_uqi4 on collection_to_entity (collection_id, exercise_name);
alter table collection_to_entity drop constraint "collection_to_entity-fk5";
alter table collection_to_entity drop column exercise_id;

alter table user_to_entity add column exercise_name varchar;
update user_to_entity cte set exercise_name = e.name
from exercise e where cte.exercise_id = e.id;
drop index "user_to_entity-uqi2"; 
create unique index "user_to_entity-uqi2" on user_to_entity (user_id, exercise_name);
alter table user_to_entity drop constraint "user_to_entity-fk3";
alter table user_to_entity drop column exercise_id;

alter table exercise drop constraint exercise_pkey;
alter table exercise rename column id to id_temp;
alter table exercise rename column name to id;
alter table exercise add primary key (id);
alter table exercise drop column id_temp;
alter table exercise drop constraint "exercise_name_key" cascade;

alter table collection_to_entity add constraint "collection_to_entity-fk5"
foreign key (exercise_name) references exercise(id) on update cascade on delete cascade;
alter table collection_to_entity rename column exercise_name to exercise_id;

alter table user_to_entity add constraint "user_to_entity-fk3"
foreign key (exercise_name) references exercise(id) on update cascade on delete cascade;
alter table user_to_entity rename column exercise_name to exercise_id;
"#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
