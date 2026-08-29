package com.example.orders;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

@Testcontainers
class MySqlMigrationIntegrationTest {
    static final String MYSQL_IMAGE = "mysql:8.4.11";

    @Container
    static final MySQLContainer MYSQL = new MySQLContainer(MYSQL_IMAGE)
        .withDatabaseName("orders")
        .withUsername("orders_test")
        .withPassword("orders_test");

    @Test
    void appliesRealMySqlMigrationAndRoundTripsMySqlValues() throws Exception {
        var mode = System.getProperty("bth.fixture.mode", "success");
        MYSQL.getJdbcUrl();
        if (mode.equals("timeout")) {
            Thread.sleep(60_000);
        }
        if (mode.equals("process-failure")) {
            Runtime.getRuntime().halt(23);
        }
        var migration = Flyway.configure()
            .dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
            .locations("classpath:db/migration")
            .load()
            .migrate();
        assertEquals(1, migration.migrationsExecuted);

        try (var connection = DriverManager.getConnection(
                MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
             var insert = connection.prepareStatement(
                 "insert into orders(id, status, metadata) values (?, ?, cast(? as json))");
             var selectOrder = connection.prepareStatement(
                 "select status, json_unquote(json_extract(metadata, '$.source')) as source " +
                     "from orders where id = ?");
             var selectCharset = connection.prepareStatement(
                 "select character_set_name from information_schema.columns " +
                     "where table_schema = database() and table_name = 'orders' and column_name = 'status'")) {
            insert.setString(1, "ORDER-DB-1");
            insert.setString(2, "READY");
            insert.setString(3, "{\"source\":\"bth\"}");
            assertEquals(1, insert.executeUpdate());

            selectOrder.setString(1, "ORDER-DB-1");
            try (var rows = selectOrder.executeQuery()) {
                assertTrue(rows.next());
                assertEquals("READY", rows.getString("status"));
                assertEquals("bth", rows.getString("source"));
            }
            try (var rows = selectCharset.executeQuery()) {
                assertTrue(rows.next());
                assertEquals("utf8mb4", rows.getString("character_set_name"));
            }
        }
        if (mode.equals("assertion-failure")) {
            fail("Synthetic assertion failure after the real MySQL interaction.");
        }
    }
}
