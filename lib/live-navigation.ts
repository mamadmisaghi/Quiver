export const liveReviewPath = (id: string, version?: number) =>
  "/app/live/review/" +
  encodeURIComponent(id) +
  (version === undefined ? "" : "?v=" + version);
export const liveRunPath = (id: string) =>
  "/app/live/runs/" + encodeURIComponent(id);
