create table orders (
    id varchar(64) primary key,
    status enum('READY', 'SHIPPED', 'CANCELLED') not null,
    metadata json not null,
    version bigint unsigned not null default 0,
    created_at timestamp(6) not null default current_timestamp(6)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_0900_ai_ci;
