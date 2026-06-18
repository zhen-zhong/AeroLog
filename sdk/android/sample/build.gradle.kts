plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.aerolog.sample"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.aerolog.sample"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "AEROLOG_SERVER_URL", "\"${providers.gradleProperty("AEROLOG_SERVER_URL").orNull ?: "http://10.0.2.2:8081"}\"")
        buildConfigField("String", "AEROLOG_TOKEN", "\"${providers.gradleProperty("AEROLOG_TOKEN").orNull ?: "demo-token"}\"")
        buildConfigField("String", "AEROLOG_SECRET", "\"${providers.gradleProperty("AEROLOG_SECRET").orNull ?: ""}\"")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation(project(":aerolog"))
}
