import { createFileRoute } from "@tanstack/react-router";
import { VideoSubtitleStudio } from "@/components/video-subtitle-studio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Video Subtitle Studio — Timeline Editor" },
      {
        name: "description",
        content:
          "Edit, translate, position, mask, and export video subtitles in a professional timeline workspace.",
      },
      { property: "og:title", content: "Video Subtitle Studio — Timeline Editor" },
      {
        property: "og:description",
        content:
          "A spatial, timeline-driven workspace for subtitle extraction, translation, and video rendering.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VideoSubtitleStudio,
});
