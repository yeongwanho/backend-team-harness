package com.example.orders;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import java.sql.DriverManager;
import java.util.Map;
import java.util.UUID;
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
        .withLabel("bth.mysql.fixture", System.getProperty("bth.fixture.owner", UUID.randomUUID().toString()))
        .withImagePullPolicy(image -> false)
        .withTmpFs(Map.of("/var/lib/mysql", "rw,size=512m"))
        .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
            new PortBinding(Ports.Binding.bindIpAndPort("127.0.0.1", 0), new ExposedPort(3306))))
        .withDatabaseName("orders")
        .withUsername("orders_test")
        .withPassword(UUID.randomUUID().toString());

    @Test
    void appliesRealMySqlMigrationAndRoundTripsMySqlValues() throws Exception {
        var mode = System.getProperty("bth.fixture.mode", "success");
        MYSQL.getJdbcUrl();
        var bindings = MYSQL.getContainerInfo().getNetworkSettings().getPorts().getBindings().get(new ExposedPort(3306));
        assertEquals(1, bindings.length);
        assertEquals("127.0.0.1", bindings[0].getHostIp());
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
