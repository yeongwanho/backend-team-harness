import java.util.UUID

plugins {
    java
}

group = "example"
version = "0.0.1"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:6.1.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.2")
}

val integrationTest by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output
    runtimeClasspath += sourceSets.main.get().output
}

configurations[integrationTest.implementationConfigurationName]
    .extendsFrom(configurations.testImplementation.get())
configurations[integrationTest.runtimeOnlyConfigurationName]
    .extendsFrom(configurations.testRuntimeOnly.get())

dependencies {
    add(integrationTest.implementationConfigurationName, "org.testcontainers:testcontainers-junit-jupiter:2.0.5")
    add(integrationTest.implementationConfigurationName, "org.testcontainers:testcontainers-mysql:2.0.5")
    add(integrationTest.implementationConfigurationName, "com.mysql:mysql-connector-j:26.7.0")
    add(integrationTest.implementationConfigurationName, "org.flywaydb:flyway-core:13.4.0")
    add(integrationTest.implementationConfigurationName, "org.flywaydb:flyway-mysql:13.4.0")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.test {
    useJUnitPlatform()
}

tasks.register<Test>("integrationTest") {
    description = "Runs MySQL 8.4 integration tests in an isolated Testcontainers database."
    group = "verification"
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    useJUnitPlatform()
    systemProperty("bth.fixture.mode", System.getProperty("bth.fixture.mode", "success"))
    systemProperty("bth.fixture.owner", System.getProperty("bth.fixture.owner", UUID.randomUUID().toString()))
    shouldRunAfter(tasks.test)
}
