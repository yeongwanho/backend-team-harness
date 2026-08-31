/*
 * Copyright 2012-2025 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.springframework.samples.petclinic;

import java.util.Map;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.HostConfig;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

// Evaluator-owned provisioning only. Original integration assertions are unchanged.
final class BthDatabaseFixture {

	private BthDatabaseFixture() {
	}

	static String password() {
		return required("BTH_SPRING_DB_PASSWORD");
	}

	private static String required(String name) {
		String value = System.getenv(name);
		if (value == null || value.isBlank()) {
			throw new IllegalStateException("Run the pinned public Maven verifier");
		}
		return value;
	}

	private static <T extends GenericContainer<?>> T isolated(T container, int port, String dataPath) {
		container.withLabel("bth.spring.fixture", required("BTH_SPRING_OWNER"));
		container.withImagePullPolicy(image -> false);
		container.withReuse(false);
		container.withTmpFs(Map.of(dataPath, "rw,size=512m"));
		container.withCreateContainerCmdModifier(cmd -> {
			HostConfig host = cmd.getHostConfig() == null ? new HostConfig() : cmd.getHostConfig();
			cmd.withHostConfig(
					host.withPortBindings(new PortBinding(new Ports.Binding("127.0.0.1", "0"), new ExposedPort(port))));
		});
		return container;
	}

	static MySQLContainer mysql() {
		MySQLContainer container = new MySQLContainer(
				DockerImageName.parse(required("BTH_SPRING_MYSQL_IMAGE")).asCompatibleSubstituteFor("mysql"));
		container.withDatabaseName("petclinic").withUsername("petclinic").withPassword(password());
		return isolated(container, 3306, "/var/lib/mysql");
	}

	static GenericContainer<?> postgres() {
		GenericContainer<?> container = new GenericContainer<>(
				DockerImageName.parse(required("BTH_SPRING_POSTGRES_IMAGE")));
		container.withExposedPorts(5432)
			.withEnv("POSTGRES_DB", "petclinic")
			.withEnv("POSTGRES_USER", "petclinic")
			.withEnv("POSTGRES_PASSWORD", password())
			.waitingFor(Wait.forLogMessage(".*database system is ready to accept connections.*\\n", 2));
		return isolated(container, 5432, "/var/lib/postgresql");
	}

}
