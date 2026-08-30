// Copy into build.gradle.kts. Architecture tests stay in src/test and get an isolated report directory.
tasks.register<Test>("architectureTest") {
    description = "Runs executable architecture rules with isolated JUnit evidence."
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform()
    filter {
        includeTestsMatching("*ArchitectureTest")
    }
    shouldRunAfter(tasks.test)
}

tasks.named<Test>("test") {
    filter {
        excludeTestsMatching("*ArchitectureTest")
    }
}
