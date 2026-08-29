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
    add(integrationTest.implementationConfigurationName, "org.testcontainers:junit-jupiter:1.21.3")
    add(integrationTest.implementationConfigurationName, "org.testcontainers:postgresql:1.21.3")
    add(integrationTest.implementationConfigurationName, "org.postgresql:postgresql:42.7.7")
    add(integrationTest.implementationConfigurationName, "org.flywaydb:flyway-core:11.13.2")
    add(integrationTest.implementationConfigurationName, "org.flywaydb:flyway-database-postgresql:11.13.2")
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
    description = "Runs PostgreSQL integration tests in an isolated Testcontainers database."
    group = "verification"
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    useJUnitPlatform()
    systemProperty("bth.fixture.mode", System.getProperty("bth.fixture.mode", "success"))
    shouldRunAfter(tasks.test)
}
