export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (process.env.GTNH_PREWARM_ON_STARTUP !== "1") {
    return;
  }

  const { prewarmLatestDatasetVersions } = await import("@/lib/server/dataset-query");
  try {
    await prewarmLatestDatasetVersions();
    console.info("GTNH dataset cache prewarmed.");
  } catch (error) {
    console.error("GTNH dataset cache prewarm failed.", error);
  }
}
