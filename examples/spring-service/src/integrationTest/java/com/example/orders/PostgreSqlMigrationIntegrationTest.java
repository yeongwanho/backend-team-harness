package com.example.orders;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;

@Testcontainers
class PostgreSqlMigrationIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
        .withDatabaseName("orders")
        .withUsername("orders_test")
        .withPassword("orders_test");

    @Test
    void appliesRealPostgresqlMigrationAndRoundTripsAnOrder() throws Exception {
        var mode = System.getProperty("bth.fixture.mode", "success");
        POSTGRES.getJdbcUrl();
        if (mode.equals("timeout")) {
            Thread.sleep(60_000);
        }
        if (mode.equals("process-failure")) {
            Runtime.getRuntime().halt(23);
        }
        Flyway.configure()
            .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
            .locations("classpath:db/migration")
            .load()
            .migrate();

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var insert = connection.prepareStatement("insert into orders(id, status) values (?, ?)");
             var select = connection.prepareStatement("select status from orders where id = ?")) {
            insert.setString(1, "ORDER-DB-1");
            insert.setString(2, "READY");
            assertEquals(1, insert.executeUpdate());

            select.setString(1, "ORDER-DB-1");
            try (var rows = select.executeQuery()) {
                rows.next();
                assertEquals("READY", rows.getString("status"));
            }
        }
        if (mode.equals("assertion-failure")) {
            fail("Synthetic assertion failure after the real database interaction.");
        }
    }
}
