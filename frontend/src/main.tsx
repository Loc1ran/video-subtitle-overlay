import React from "react";
import ReactDOM from "react-dom/client";
import { VideoSubtitleStudio } from "./components/video-subtitle-studio";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VideoSubtitleStudio />
  </React.StrictMode>,
);
