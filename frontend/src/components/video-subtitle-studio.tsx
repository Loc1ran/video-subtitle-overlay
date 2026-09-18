import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bookmark,
  Bot,
  Brain,
  Captions,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Clock3,
  Download,
  Eye,
  Film,
  FlipHorizontal,
  FolderOpen,
  GripVertical,
  Heart,
  Languages,
  Layers3,
  Link2,
  Lock,
  Maximize2,
  Menu,
  MessageCircle,
  Mic2,
  Monitor,
  MousePointer2,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Search,
  Settings2,
  Share2,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkle,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  Wand2,
  ZoomIn,
  ZoomOut,
  X,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildLocalizedAiPrompt } from "@/lib/localized-prompts";
import previewImage from "@/assets/studio-preview.jpg";

type Source = "OCR" | "WHISPER" | "IMPORT";
type Anchor = "left" | "center" | "right";
type Segment = {
  id: number;
  track: number;
  start: number;
  end: number;
  source: Source;
  original: string;
  translated: string;
  x: number;
  y: number;
  anchor: Anchor;
  outlineColor?: string;
  textColor?: string;
  bgColor?: string;
  boxW?: number;
  boxH?: number;
};

type RecentVideo = {
  file_id: string;
  filename: string;
  video_url: string;
  has_transcript?: boolean;
};

type DragState = {
  id: number;
  kind: "move" | "trim-start" | "trim-end";
  originX: number;
  start: number;
  end: number;
} | null;

const FPS = 30;
const LABEL_WIDTH = 176;

const INITIAL_SEGMENTS: Segment[] = [
  {
    id: 1,
    track: 0,
    start: 0.8,
    end: 4.9,
    source: "OCR",
    original: "A new city, a new beginning",
    translated: "Một thành phố mới, một khởi đầu mới",
    x: 50,
    y: 18,
    anchor: "center",
  },
  {
    id: 2,
    track: 1,
    start: 2.1,
    end: 6.4,
    source: "WHISPER",
    original: "I thought I had everything planned.",
    translated: "Tôi cứ nghĩ mình đã lên kế hoạch cho tất cả.",
    x: 50,
    y: 84,
    anchor: "center",
  },
  {
    id: 3,
    track: 1,
    start: 6.8,
    end: 10.7,
    source: "WHISPER",
    original: "But travel has a way of surprising you.",
    translated: "Nhưng những chuyến đi luôn biết cách khiến ta bất ngờ.",
    x: 50,
    y: 84,
    anchor: "center",
  },
  {
    id: 4,
    track: 0,
    start: 8.7,
    end: 13.2,
    source: "OCR",
    original: "GATE 24 · DEPARTURES",
    translated: "CỔNG 24 · KHỞI HÀNH",
    x: 78,
    y: 20,
    anchor: "right",
  },
  {
    id: 5,
    track: 1,
    start: 11.1,
    end: 16.2,
    source: "WHISPER",
    original: "Sometimes the wrong train takes you to the right place.",
    translated: "Đôi khi chuyến tàu nhầm lại đưa bạn đến đúng nơi.",
    x: 50,
    y: 84,
    anchor: "center",
  },
  {
    id: 6,
    track: 2,
    start: 14.1,
    end: 18.5,
    source: "OCR",
    original: "Next stop: Central Station",
    translated: "Trạm tiếp theo: Ga Trung tâm",
    x: 14,
    y: 34,
    anchor: "left",
  },
  {
    id: 7,
    track: 1,
    start: 17.1,
    end: 22.8,
    source: "WHISPER",
    original: "So I stopped looking at the map.",
    translated: "Vậy nên tôi đã thôi nhìn vào bản đồ.",
    x: 50,
    y: 84,
    anchor: "center",
  },
];

function formatTime(value: number, frames = false) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const frame = Math.floor((safe % 1) * FPS);
  return frames
    ? `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frame).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hexToRgb(hex: string): string {
  const clean = (hex || "#000000").replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return `${r}, ${g}, ${b}`;
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `${r}, ${g}, ${b}`;
}

/**
 * Returns a very dark tinted version of `hex`.
 * factor = 0.12 → keeps ~12 % of each channel (very dark, themed tint).
 * Used to auto-theme the box background from the detected accent/text colour.
 */
function darkenColor(hex: string, factor = 0.12): string {
  const clean = (hex || "#000000").replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0");
  const r = Math.round(parseInt(full.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(full.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(full.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function getContrastTextColor(hex: string): string {
  const clean = (hex || "#000000").replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0");
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 165 ? "#111111" : "#FFFFFF";
}

const TRACKS = [
  { name: "VISUAL TEXT", type: "OCR · upper", icon: Eye },
  { name: "DIALOGUE", type: "Whisper · bottom", icon: Mic2 },
  { name: "CALLOUTS", type: "OCR · spatial", icon: Captions },
];

function IconButton({
  label,
  active,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={active ? "active" : "ghost"}
      size="icon-sm"
      {...props}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="editor-label">{children}</span>;
}

export const SUPPORTED_TARGET_LANGUAGES: { code: string; label: string }[] = [
  { code: "vi", label: "Vietnamese" },
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ru", label: "Russian" },
  { code: "th", label: "Thai" },
  { code: "id", label: "Indonesian" },
];

export function getLanguageLabel(code: string): string {
  const found = SUPPORTED_TARGET_LANGUAGES.find((l) => l.code === code);
  return found ? found.label : code ? code.toUpperCase() : "Target Language";
}

export function VideoSubtitleStudio() {
  // Project & Media State
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFilename, setVideoFilename] = useState("tokyo_diary_final.mp4");
  const [videoResolution, setVideoResolution] = useState("1920 × 1080 · 30 fps");
  const [videoNaturalAspect, setVideoNaturalAspect] = useState<string | null>(null);
  const [duration, setDuration] = useState(24);
  const [recentVideos, setRecentVideos] = useState<RecentVideo[]>([]);
  const [isSaved, setIsSaved] = useState(true);

  // Subtitle & Editor State
  const [segments, setSegments] = useState<Segment[]>(INITIAL_SEGMENTS);
  const [history, setHistory] = useState<Segment[][]>([INITIAL_SEGMENTS]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null); // Null by default so no line appears on load
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [showSafeZones, setShowSafeZones] = useState(false);

  // Docks & Viewport
  const [sourceTab, setSourceTab] = useState<"media" | "transcript">("transcript");
  const [inspectorTab, setInspectorTab] = useState<"segment" | "style">("segment");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);

  // Styling & Masking
  const [maskMode, setMaskMode] = useState("Fitted box");
  const [opacity, setOpacity] = useState(100);
  const [fontSize, setFontSize] = useState(34);
  const [padding, setPadding] = useState(14);
  const [borderRadius, setBorderRadius] = useState(18); // Modern rounded corners
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [outlineColor, setOutlineColor] = useState("#000000"); // Black stroke
  const [outlineWidth, setOutlineWidth] = useState(2);
  const [bgColor, setBgColor] = useState("#000000"); // Solid black background
  const [detectedPalette, setDetectedPalette] = useState<string[]>([
    "#A0456D",
    "#A13967",
    "#DCA797",
    "#AA7B66",
    "#FFFFFF",
    "#000000",
  ]);
  const [isDetectingColors, setIsDetectingColors] = useState(false);
  const [bold, setBold] = useState(true);
  const [thinkingMode, setThinkingMode] = useState(true);

  // Engines & Status
  const [status, setStatus] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<{
    isRunning: boolean;
    engine: string;
    percent: number;
    stage: string;
    foundCount: number;
    status: "idle" | "running" | "completed" | "error";
  }>({
    isRunning: false,
    engine: "Screen OCR",
    percent: 0,
    stage: "",
    foundCount: 0,
    status: "idle",
  });
  const [renderResult, setRenderResult] = useState<{
    video_url: string;
    srt_url: string;
    ass_url: string;
    filename: string;
  } | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showBurnModal, setShowBurnModal] = useState(false);
  const [showBurnMenu, setShowBurnMenu] = useState(false);
  const [showProjectsDropdown, setShowProjectsDropdown] = useState(false);
  const [targetLang, setTargetLang] = useState("vi");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const aiJobPollRef = useRef<number | null>(null);

  // Auto Reframe state
  const [reframeTarget, setReframeTarget] = useState<"original" | "tiktok" | "youtube">("original");
  const [reframeMode, setReframeMode] = useState<"blur" | "crop" | "fit">("blur");
  const [showTikTokUI, setShowTikTokUI] = useState(true);
  const [flipHorizontal, setFlipHorizontal] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState>(null);
  const canvasDragRef = useRef<{ x: number; y: number } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  const selected = useMemo(
    () => segments.find((s) => s.id === selectedId) ?? null,
    [segments, selectedId],
  );
  const activeSegments = useMemo(
    () => segments.filter((s) => playhead >= s.start && playhead <= s.end),
    [segments, playhead],
  );

  // Dynamically resolve vertical collisions ONLY between simultaneous upper title cards (y < 70)
  // Dialogue subtitles (y >= 70) MUST NEVER be displaced vertically!
  const positionedActiveSegments = useMemo(() => {
    if (activeSegments.length <= 1) {
      return activeSegments.map((s) => ({ ...s, displayY: s.y }));
    }

    const upperSegments = activeSegments.filter((s) => s.y < 70 && s.track === 0);
    const dialogueSegments = activeSegments.filter((s) => s.y >= 70 || s.track !== 0);

    const mappedDialogue = dialogueSegments.map((s) => ({ ...s, displayY: s.y }));

    if (upperSegments.length <= 1) {
      return [...upperSegments.map((s) => ({ ...s, displayY: s.y })), ...mappedDialogue];
    }

    const sortedUpper = upperSegments
      .map((s) => ({ ...s, displayY: s.y }))
      .sort((a, b) => a.displayY - b.displayY);

    const minClearancePct = 3.2; // Clean vertical clearance between multi-line headers (only adjust if genuinely colliding)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < sortedUpper.length - 1; i++) {
        const top = sortedUpper[i];
        const btm = sortedUpper[i + 1];
        // Only apply vertical clearance if they are actually in the same horizontal column (within 20% X)
        const isHorizontallyOverlapping = Math.abs((top.x ?? 50) - (btm.x ?? 50)) < 22.0;
        if (!isHorizontallyOverlapping) continue;

        const gap = btm.displayY - top.displayY;
        if (gap < minClearancePct) {
          const needed = minClearancePct - gap;
          if (top.id === selectedId) {
            btm.displayY = Math.min(65, btm.displayY + needed);
          } else if (btm.id === selectedId) {
            top.displayY = Math.max(8, top.displayY - needed);
          } else {
            top.displayY = Math.max(8, top.displayY - needed / 2);
            btm.displayY = Math.min(65, btm.displayY + needed / 2);
          }
        }
      }
    }

    return [...sortedUpper, ...mappedDialogue];
  }, [activeSegments, selectedId]);

  const timelineWidth = Math.max(900, duration * 35) * zoom;

  // --------------------------------------------------------------------------
  // INITIALIZATION & RECENT PROJECTS
  // --------------------------------------------------------------------------
  useEffect(() => {
    fetchRecentVideos();
  }, []);

  async function fetchRecentVideos() {
    try {
      const res = await fetch("/api/videos");
      if (res.ok) {
        const data = await res.json();
        const list: RecentVideo[] = data.videos || (Array.isArray(data) ? data : []);
        setRecentVideos(list);

        // Check if there was an active project saved in localStorage
        const savedFileId = localStorage.getItem("vss_active_file_id");
        if (savedFileId && list.some((p) => p.file_id === savedFileId)) {
          loadProject(savedFileId, false);
        } else if (list.length > 0 && list[0]) {
          loadProject(list[0].file_id, false);
        }
      }
    } catch {
      // Backend not running or error - stay with initial demo state
    }
  }

  async function loadProject(fileId: string, showAlert = true) {
    try {
      quickAction(`Loading project ${fileId}...`);
      const res = await fetch(`/api/load/${fileId}`);
      if (!res.ok) throw new Error("Failed to load project");
      const data = await res.json();

      setCurrentFileId(data.file_id);
      localStorage.setItem("vss_active_file_id", data.file_id);

      const resolvedName = data.filename || (data.info && data.info.filename) || "video.mp4";
      setVideoFilename(resolvedName);
      setVideoUrl(data.video_url || `/api/video/${data.file_id}`);

      const dur = (data.info && data.info.duration) || data.duration || 24;
      setDuration(Math.max(1, dur));

      if (data.info && data.info.width && data.info.height) {
        setVideoResolution(
          `${data.info.width} × ${data.info.height} · ${Math.round(data.info.fps || 30)} fps`,
        );
        setVideoNaturalAspect(`${data.info.width} / ${data.info.height}`);
      }

      if (data.style) {
        if (data.style.font_size) setFontSize(Number(data.style.font_size));
        if (data.style.bg_padding) setPadding(Number(data.style.bg_padding));
        if (data.style.border_radius !== undefined)
          setBorderRadius(Number(data.style.border_radius));
        if (data.style.bg_opacity !== undefined)
          setOpacity(Math.round(Number(data.style.bg_opacity) * 100));
        else setOpacity(100);
        if (data.style.mask_mode) {
          setMaskMode(
            data.style.mask_mode === "full_bar"
              ? "Full-width bar"
              : data.style.mask_mode === "outline"
                ? "Text outline"
                : "Fitted box",
          );
        }
        if (data.style.bold !== undefined) setBold(Boolean(data.style.bold));
        const loadedOutline = data.style.outline_color || "#000000";
        const savedBg = data.style.bg_color || "#000000";
        setOutlineColor(loadedOutline);
        setBgColor(savedBg);
        if (data.style.outline_width !== undefined)
          setOutlineWidth(Number(data.style.outline_width));
        if (data.style.text_color) setTextColor(data.style.text_color);
      }

      if (data.target_lang) {
        setTargetLang(data.target_lang);
      }

      if (data.reframe_target) {
        setReframeTarget(data.reframe_target);
      }
      if (data.reframe_mode) {
        setReframeMode(data.reframe_mode);
      }
      if (data.flip_horizontal !== undefined) {
        setFlipHorizontal(Boolean(data.flip_horizontal));
      } else {
        setFlipHorizontal(false);
      }

      if (data.segments && Array.isArray(data.segments)) {
        if (data.segments.length > 0) {
          const loadedSegs: Segment[] = data.segments.map((s: any) => {
            const x = s.x_pct !== undefined && s.x_pct !== null ? Number(s.x_pct) : 50;
            const y =
              s.y_pct !== undefined && s.y_pct !== null
                ? Number(s.y_pct)
                : s.track_id === 1
                  ? 18
                  : 84;
            const anchor = "center";
            const isSideSticker = (x < 30 || x > 70) && y < 70;
            const isHeader = y < 70 && !isSideSticker;
            const track =
              s.track_id !== undefined && s.track_id !== null
                ? Math.max(0, Math.min(2, s.track_id - 1))
                : isSideSticker
                  ? 2
                  : isHeader
                    ? 0
                    : 1;
            return {
              id: s.id,
              track,
              start: Number(s.start),
              end: Number(s.end),
              source: s.track_id === 1 || y < 70 ? "OCR" : "WHISPER",
              original: s.text || "",
              translated:
                s.custom_text !== undefined && s.custom_text !== null
                  ? s.custom_text
                  : s.text || "",
              x,
              y,
              anchor,
              outlineColor: s.outline_color || loadedOutline,
              textColor:
                s.text_color ||
                (data.style && data.style.text_color) ||
                getContrastTextColor(s.bg_color || savedBg),
              bgColor: s.bg_color || savedBg,
              boxW: s.box_w ? Number(s.box_w) : undefined,
              boxH: s.box_h ? Number(s.box_h) : undefined,
            };
          });
          setSegments(loadedSegs);
          pushHistory(loadedSegs);
        } else {
          setSegments([]);
          pushHistory([]);
        }
      }
      setSelectedId(null); // Keep selection clear on load
      setPlayhead(0);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
      quickAction(`Loaded ${resolvedName}`);
    } catch (err: any) {
      if (showAlert) quickAction(`Error loading project: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // HISTORY & UNDO / REDO
  // --------------------------------------------------------------------------
  function pushHistory(newSegments: Segment[]) {
    const updated = history.slice(0, historyIndex + 1);
    updated.push(newSegments);
    if (updated.length > 30) updated.shift();
    setHistory(updated);
    setHistoryIndex(updated.length - 1);
    scheduleAutoSave(newSegments);
  }

  function undo() {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      const targetState = history[nextIdx];
      if (targetState) {
        setHistoryIndex(nextIdx);
        setSegments(targetState);
        scheduleAutoSave(targetState);
        quickAction("Undo");
      }
    }
  }

  function redo() {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      const targetState = history[nextIdx];
      if (targetState) {
        setHistoryIndex(nextIdx);
        setSegments(targetState);
        scheduleAutoSave(targetState);
        quickAction("Redo");
      }
    }
  }

  const handleDetectColors = async () => {
    if (!currentFileId) {
      quickAction("Please load a video first");
      return;
    }
    setIsDetectingColors(true);
    quickAction("Scanning video frames to detect subtitle accent colors...");
    try {
      const res = await fetch(`/api/detect-colors/${currentFileId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Color detection failed");
      const data = await res.json();

      const detectedBg = data.dominant_bg || data.dominant_outline || "#000000";
      const detectedText =
        data.dominant_text ||
        (detectedBg !== "#000000" ? getContrastTextColor(detectedBg) : "#FFFFFF");
      const detectedOutline = data.dominant_outline || detectedBg;

      setBgColor(detectedBg);
      setOutlineColor(detectedOutline);
      setTextColor(detectedText);
      setOutlineWidth(data.has_accent ? 2 : 0);
      setOpacity(100);

      if (data.detected_palette && data.detected_palette.length > 0) {
        setDetectedPalette(data.detected_palette);
      }

      setSegments((prev) => {
        const segColors = data.segment_colors || {};
        const titleAccent = data.dominant_title_accent || detectedBg;
        const updated = prev.map((s) => {
          const sc = segColors[s.id] || {};
          const isDiag = s.y >= 70;
          const targetBg = sc.bg_color || (isDiag ? detectedBg : titleAccent);
          const targetOutline = sc.outline_color || (isDiag ? detectedOutline : titleAccent);
          const targetText =
            sc.text_color || (isDiag ? detectedText : getContrastTextColor(titleAccent));
          return {
            ...s,
            outlineColor: targetOutline,
            bgColor: targetBg,
            textColor: targetText,
          };
        });
        scheduleAutoSave(updated);
        return updated;
      });

      quickAction(`✨ Applied original subtitle color (${detectedBg}) to background`);
    } catch (e: any) {
      quickAction(`Color detection error: ${e.message}`);
    } finally {
      setIsDetectingColors(false);
    }
  };

  // --------------------------------------------------------------------------
  // PERSISTENCE & AUTO-SAVE
  // --------------------------------------------------------------------------
  function scheduleAutoSave(itemsToSave: Segment[], flipOverride?: boolean) {
    setIsSaved(false);
    if (!currentFileId) return;
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    const effectiveFlip = flipOverride !== undefined ? flipOverride : flipHorizontal;
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const payload = {
          segments: itemsToSave.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            text: s.original || s.translated,
            custom_text: s.translated || s.original,
            x_pct: s.x,
            y_pct: s.y,
            anchor: s.anchor === "left" ? "\\an4" : s.anchor === "right" ? "\\an6" : "\\an5",
            track_id: s.track + 1,
            outline_color: s.outlineColor,
            text_color: s.textColor,
            bg_color: s.bgColor,
            box_w: s.boxW,
            box_h: s.boxH,
          })),
          style: {
            font_size: fontSize,
            mask_mode:
              maskMode === "Fitted box"
                ? "box"
                : maskMode === "Full-width bar"
                  ? "full_bar"
                  : "outline",
            bg_opacity: opacity / 100,
            bg_padding: padding,
            border_radius: borderRadius,
            outline_color: outlineColor,
            outline_width: outlineWidth,
            text_color: textColor,
            bg_color: bgColor,
            bold,
          },
          styles: {
            font_size: fontSize,
            mask_mode:
              maskMode === "Fitted box"
                ? "box"
                : maskMode === "Full-width bar"
                  ? "full_bar"
                  : "outline",
            bg_opacity: opacity / 100,
            bg_padding: padding,
            border_radius: borderRadius,
            outline_color: outlineColor,
            outline_width: outlineWidth,
            text_color: textColor,
            bg_color: bgColor,
            bold,
          },
          target_lang: targetLang,
          current_time: playhead,
          reframe_target: reframeTarget,
          reframe_mode: reframeMode,
          flip_horizontal: effectiveFlip,
        };
        await fetch(`/api/save-state/${currentFileId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setIsSaved(true);
      } catch {}
    }, 800);
  }

  function toggleFlipHorizontal() {
    setFlipHorizontal((prev) => {
      const next = !prev;
      scheduleAutoSave(segments, next);
      quickAction(
        next
          ? "Video flipped horizontally (Mirrored) · Subtitles preserved"
          : "Video reverted to normal orientation",
      );
      return next;
    });
  }

  // --------------------------------------------------------------------------
  // VIDEO PLAYBACK SYNCHRONIZATION
  // --------------------------------------------------------------------------
  const seekToTime = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(duration, time));
      setPlayhead(clamped);
      if (videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
      if (bgVideoRef.current) {
        bgVideoRef.current.currentTime = clamped;
      }
    },
    [duration],
  );

  function handleLoadedMetadata() {
    if (!videoRef.current) return;
    const vid = videoRef.current;
    if (vid.duration && !isNaN(vid.duration)) {
      setDuration(vid.duration);
    }
    if (vid.videoWidth && vid.videoHeight) {
      setVideoResolution(`${vid.videoWidth} × ${vid.videoHeight} · 30 fps`);
      setVideoNaturalAspect(`${vid.videoWidth} / ${vid.videoHeight}`);
    }
  }

  function handleTimeUpdate() {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setPlayhead(cur);
    if (bgVideoRef.current && Math.abs(bgVideoRef.current.currentTime - cur) > 0.25) {
      bgVideoRef.current.currentTime = cur;
    }
    if (loop && selected && cur >= selected.end) {
      videoRef.current.currentTime = selected.start;
      if (bgVideoRef.current) bgVideoRef.current.currentTime = selected.start;
    }
  }

  // Real-time 60fps playhead tracking during playback to eliminate low-frequency onTimeUpdate latency
  useEffect(() => {
    let animFrame: number;
    const syncPlayhead = () => {
      if (videoRef.current && !videoRef.current.paused) {
        const cur = videoRef.current.currentTime;
        setPlayhead(cur);
        if (bgVideoRef.current && Math.abs(bgVideoRef.current.currentTime - cur) > 0.3) {
          bgVideoRef.current.currentTime = cur;
        }
        if (loop && selected && cur >= selected.end) {
          videoRef.current.currentTime = selected.start;
          if (bgVideoRef.current) bgVideoRef.current.currentTime = selected.start;
        }
      }
      if (playing) {
        animFrame = requestAnimationFrame(syncPlayhead);
      }
    };

    if (playing) {
      animFrame = requestAnimationFrame(syncPlayhead);
    }
    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
    };
  }, [playing, loop, selected]);

  function togglePlayPause() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
      setPlaying(true);
    } else {
      videoRef.current.pause();
      if (bgVideoRef.current) bgVideoRef.current.pause();
      setPlaying(false);
    }
  }

  function handleSpeedChange(newSpeed: number) {
    setSpeed(newSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = newSpeed;
    }
    if (bgVideoRef.current) {
      bgVideoRef.current.playbackRate = newSpeed;
    }
  }

  function handleVolumeChange(newVol: number) {
    setVolume(newVol);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
    }
  }

  // --------------------------------------------------------------------------
  // FILE UPLOAD & INGESTION
  // --------------------------------------------------------------------------
  async function uploadFile(file: File) {
    quickAction(`Uploading ${file.name}...`);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      localStorage.setItem("vss_active_file_id", data.file_id);
      await fetchRecentVideos();
      await loadProject(data.file_id, true);
      // Automatically navigate to transcript tab upon uploading new source
      setSourceTab("transcript");
      setLeftOpen(true);
      quickAction(`Loaded ${file.name} — ready for transcript extraction`);
    } catch (err: any) {
      quickAction(`Upload error: ${err.message}`);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    if (e.target) e.target.value = "";
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith("video/") || /\.(mp4|mkv|mov|avi|webm)$/i.test(file.name))) {
      uploadFile(file);
    }
  }

  // --------------------------------------------------------------------------
  // AI EXTRACTION & TRANSLATION ENGINES
  // --------------------------------------------------------------------------
  async function runExtraction(engine: "OCR" | "WHISPER" | "ALL") {
    if (!currentFileId) {
      quickAction("Please load a video first");
      return;
    }
    const engineLabel =
      engine === "WHISPER"
        ? "Whisper ASR"
        : engine === "ALL"
          ? "OCR + Whisper"
          : "Screen OCR (EasyOCR)";
    setSourceTab("transcript");
    setIsAnalyzing(true);
    setExtractionProgress({
      isRunning: true,
      engine: engineLabel,
      percent: 2,
      stage: `Starting ${engineLabel}...`,
      foundCount: 0,
      status: "running",
    });
    quickAction(`Running ${engineLabel}...`);

    let pollInterval: any = null;
    pollInterval = setInterval(async () => {
      try {
        const pRes = await fetch(`/api/extraction-progress/${currentFileId}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.progress && pData.progress.status === "running") {
            setExtractionProgress((prev) => ({
              ...prev,
              percent: pData.progress.percent !== undefined ? pData.progress.percent : prev.percent,
              stage: pData.progress.stage || prev.stage,
              foundCount:
                pData.progress.found_count !== undefined
                  ? pData.progress.found_count
                  : prev.foundCount,
              status: "running",
            }));
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 400);

    try {
      const res = await fetch("/api/auto-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: currentFileId,
          target_lang: targetLang,
          model_size: "base",
          transcript_source: engine === "WHISPER" ? "audio_whisper" : "video_ocr",
          enable_ocr: engine === "OCR" || engine === "ALL",
          enable_transcribe: engine === "WHISPER" || engine === "ALL",
          translation_mode: "none",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Extraction failed");
      }
      const data = await res.json();
      if (data.auto_style) {
        if (data.auto_style.bg_color) setBgColor(data.auto_style.bg_color);
        if (data.auto_style.text_color) setTextColor(data.auto_style.text_color);
        if (data.auto_style.outline_color) setOutlineColor(data.auto_style.outline_color);
        if (data.auto_style.font_size) setFontSize(Number(data.auto_style.font_size));
        if (data.auto_style.bg_padding) setPadding(Number(data.auto_style.bg_padding));
      }
      if (data.color_info?.detected_palette && data.color_info.detected_palette.length > 0) {
        setDetectedPalette(data.color_info.detected_palette);
      }

      if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
        const fallbackBg = data.auto_style?.bg_color || "#000000";
        const fallbackText = data.auto_style?.text_color || "#FFFFFF";
        const fallbackOutline = data.auto_style?.outline_color || "#000000";

        const mapped: Segment[] = data.segments.map((s: any) => {
          const x = s.x_pct !== undefined && s.x_pct !== null ? Number(s.x_pct) : 50;
          const y =
            s.y_pct !== undefined && s.y_pct !== null
              ? Number(s.y_pct)
              : s.track_id === 1
                ? 18
                : 84;
          const anchor = s.anchor
            ? s.anchor.includes("4")
              ? "left"
              : s.anchor.includes("6")
                ? "right"
                : "center"
            : "center";
          const isSideSticker = (x < 30 || x > 70) && y < 70;
          const isHeader = y < 70 && !isSideSticker;
          const track =
            s.track_id !== undefined && s.track_id !== null
              ? Math.max(0, Math.min(2, s.track_id - 1))
              : isSideSticker
                ? 2
                : isHeader
                  ? 0
                  : 1;
          return {
            id: s.id,
            track,
            start: Number(s.start),
            end: Number(s.end),
            source: s.track_id === 1 || y < 70 ? "OCR" : "WHISPER",
            original: s.text || "",
            translated:
              s.custom_text !== undefined && s.custom_text !== null ? s.custom_text : s.text || "",
            x,
            y,
            anchor,
            outlineColor: s.outline_color || fallbackOutline,
            textColor: s.text_color || fallbackText,
            bgColor: s.bg_color || fallbackBg,
            boxW: s.box_w ? Number(s.box_w) : undefined,
            boxH: s.box_h ? Number(s.box_h) : undefined,
          };
        });
        setSegments(mapped);
        pushHistory(mapped);
        setSelectedId(null); // Clean default state
        setExtractionProgress({
          isRunning: false,
          engine: engineLabel,
          percent: 100,
          stage: `Extraction complete: ${mapped.length} subtitles detected!`,
          foundCount: mapped.length,
          status: "completed",
        });
        quickAction(`Extracted ${mapped.length} subtitle segments!`);
      } else {
        setSegments([]);
        setSelectedId(null);
        setExtractionProgress({
          isRunning: false,
          engine: engineLabel,
          percent: 100,
          stage: "Extraction complete: 0 subtitles detected.",
          foundCount: 0,
          status: "completed",
        });
        quickAction("No subtitles detected in video.");
      }
    } catch (err: any) {
      setExtractionProgress((prev) => ({
        ...prev,
        isRunning: false,
        status: "error",
        stage: `Failed: ${err.message}`,
      }));
      quickAction(`Extraction error: ${err.message}`);
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      setIsAnalyzing(false);
      setTimeout(() => {
        setExtractionProgress((prev) =>
          prev.isRunning ? prev : { ...prev, percent: 0, status: "idle" },
        );
      }, 5000);
    }
  }

  async function batchTranslate() {
    if (segments.length === 0) {
      quickAction("No subtitles to translate");
      return;
    }
    setIsTranslating(true);
    const targetLabel = getLanguageLabel(targetLang);
    quickAction(`Translating all segments to ${targetLabel}...`);

    try {
      const payload = {
        segments: segments.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          text: s.original || s.translated,
          custom_text: s.translated || s.original,
          x_pct: s.x,
          y_pct: s.y,
        })),
        target_lang: targetLang,
        source_lang: "auto",
      };
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();

      if (data.segments) {
        const transMap = new Map<number, string>(
          data.segments.map((s: any) => [s.id, String(s.custom_text || s.text || "")]),
        );
        const updated: Segment[] = segments.map((s) => ({
          ...s,
          original: s.original || s.translated,
          translated: transMap.get(s.id) || s.translated,
        }));
        setSegments(updated);
        pushHistory(updated);
        quickAction(`Translated ${updated.length} segments to ${targetLabel}`);
      }
    } catch (err: any) {
      quickAction(`Translation error: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  }

  async function translateSingleSelected() {
    if (!selected) return;
    const textToTranslate = (selected.original || selected.translated || "").trim();
    if (!textToTranslate) {
      quickAction("No text to translate");
      return;
    }
    const targetLabel = getLanguageLabel(targetLang);
    quickAction(`Translating to ${targetLabel}...`);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: [
            { id: selected.id, start: selected.start, end: selected.end, text: textToTranslate },
          ],
          target_lang: targetLang,
          source_lang: "auto",
        }),
      });
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();
      if (data.segments && data.segments[0]) {
        const transResult = data.segments[0].custom_text || data.segments[0].text;
        updateSelected({
          original: selected.original || textToTranslate,
          translated: transResult,
        });
        quickAction(`Translated segment to ${targetLabel}`);
      }
    } catch (err: any) {
      quickAction(`Error: ${err.message}`);
    }
  }

  function startAiJobWatcher() {
    if (aiJobPollRef.current) clearInterval(aiJobPollRef.current);

    aiJobPollRef.current = window.setInterval(async () => {
      if (!currentFileId) return;
      try {
        const res = await fetch("/api/ai-job");
        if (!res.ok) return;
        const data = await res.json();
        if (
          data &&
          data.job &&
          data.job.status === "completed" &&
          data.job.file_id === currentFileId
        ) {
          if (aiJobPollRef.current) {
            clearInterval(aiJobPollRef.current);
            aiJobPollRef.current = null;
          }
          // Reload state from backend
          const loadRes = await fetch(`/api/load/${currentFileId}`);
          if (loadRes.ok) {
            const loadData = await loadRes.json();
            if (loadData.style) {
              if (loadData.style.bg_color) setBgColor(loadData.style.bg_color);
              if (loadData.style.text_color) setTextColor(loadData.style.text_color);
              if (loadData.style.outline_color) setOutlineColor(loadData.style.outline_color);
              if (loadData.style.font_size) setFontSize(Number(loadData.style.font_size));
              if (loadData.style.bg_padding) setPadding(Number(loadData.style.bg_padding));
              if (loadData.style.border_radius !== undefined)
                setBorderRadius(Number(loadData.style.border_radius));
            }
            if (loadData.segments && Array.isArray(loadData.segments)) {
              const fallbackBg = loadData.style?.bg_color || bgColor || "#000000";
              const fallbackText = loadData.style?.text_color || textColor || "#FFFFFF";
              const fallbackOutline = loadData.style?.outline_color || outlineColor || "#000000";

              const mapped: Segment[] = loadData.segments.map((s: any) => ({
                id: s.id,
                track: s.track_id
                  ? Math.max(0, Math.min(2, s.track_id - 1))
                  : s.y_pct && s.y_pct < 35
                    ? 0
                    : 1,
                start: s.start,
                end: s.end,
                source: s.track_id === 1 ? "OCR" : s.track_id === 3 ? "OCR" : "WHISPER",
                original: s.text || "",
                translated: s.custom_text || s.text || "",
                x: s.x_pct !== undefined && s.x_pct !== null ? s.x_pct : 50,
                y: s.y_pct !== undefined && s.y_pct !== null ? s.y_pct : s.track_id === 1 ? 18 : 84,
                outlineColor: s.outline_color || fallbackOutline,
                textColor: s.text_color || fallbackText,
                bgColor: s.bg_color || fallbackBg,
                boxW: s.box_w ? Number(s.box_w) : undefined,
                boxH: s.box_h ? Number(s.box_h) : undefined,
              }));
              setSegments(mapped);
              pushHistory(mapped);
              quickAction(`🎉 AI Translation complete! Imported ${mapped.length} subtitles.`);
            }
          }
        }
      } catch {}
    }, 1500);

    setTimeout(() => {
      if (aiJobPollRef.current) {
        clearInterval(aiJobPollRef.current);
        aiJobPollRef.current = null;
      }
    }, 240000);
  }

  async function launchAiTranslation(targetService: "chatgpt" | "claude" | "deepseek") {
    if (!currentFileId) {
      quickAction("Please load a video first");
      return;
    }
    if (segments.length === 0) {
      quickAction("No subtitles to translate");
      return;
    }

    const serviceName =
      targetService === "chatgpt" ? "ChatGPT" : targetService === "claude" ? "Claude" : "DeepSeek";
    const serviceUrl =
      targetService === "chatgpt"
        ? thinkingMode
          ? "https://chatgpt.com/?model=o3-mini&ref=vss_auto"
          : "https://chatgpt.com/?ref=vss_auto"
        : targetService === "claude"
          ? "https://claude.ai/new?ref=vss_auto"
          : "https://chat.deepseek.com/?ref=vss_auto";

    const lines = segments.map((s) => `#${s.id}: ${s.original || s.translated}`).join("\n");
    const prompt = buildLocalizedAiPrompt(targetLang, thinkingMode, lines);

    // 1. Copy formatted prompt to clipboard
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {}

    // 2. Queue the job in the backend
    try {
      await fetch("/api/ai-job/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: currentFileId,
          target_lang: targetLang,
          thinking_mode: thinkingMode,
          prompt: prompt,
          segments: segments.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            text: s.original,
            custom_text: s.translated,
            x_pct: s.x,
            y_pct: s.y,
          })),
        }),
      });
    } catch (e) {
      console.warn("Could not queue job:", e);
    }

    // 3. Open the AI chat tab with the auto-trigger parameter
    window.open(serviceUrl, "_blank");

    quickAction(
      `Opening ${serviceName}... Extension will auto-type & submit (or press Ctrl+V to paste)`,
    );
    startAiJobWatcher();
  }

  // --------------------------------------------------------------------------
  // SUBTITLE EXPORT & VIDEO BURNING
  // --------------------------------------------------------------------------
  function exportSubtitles(format: "srt" | "ass" | "json") {
    if (segments.length === 0) {
      quickAction("No subtitles to export");
      return;
    }
    let content = "";
    let mimeType = "text/plain";
    const filename = `${videoFilename.replace(/\.[^/.]+$/, "")}.${format}`;

    if (format === "srt") {
      content = segments
        .map((s, idx) => {
          const startStr = formatSrtTime(s.start);
          const endStr = formatSrtTime(s.end);
          return `${idx + 1}\n${startStr} --> ${endStr}\n${s.translated || s.original}\n\n`;
        })
        .join("");
    } else if (format === "json") {
      content = JSON.stringify(segments, null, 2);
      mimeType = "application/json";
    } else {
      content = generateAssContent();
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
    quickAction(`Exported ${filename}`);
  }

  function formatSrtTime(sec: number) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }

  function generateAssContent() {
    const header = `[Script Info]\nTitle: Video Subtitle Studio Export\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Alignment, MarginV\nStyle: Default,Arial,${fontSize},&H00FFFFFF,&H00000000,1,2,30\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n`;
    const dialogues = segments
      .map((s) => {
        const st = formatAssTime(s.start);
        const et = formatAssTime(s.end);
        const an = s.anchor === "left" ? "\\an4" : s.anchor === "right" ? "\\an6" : "\\an5";
        const pos = `{\\pos(${Math.round(s.x * 19.2)},${Math.round(s.y * 10.8)})${an}}`;
        return `Dialogue: 0,${st},${et},Default,${pos}${s.translated || s.original}`;
      })
      .join("\n");
    return header + dialogues;
  }

  function formatAssTime(sec: number) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const cs = Math.floor((sec % 1) * 100);
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  async function burnAndExportVideo() {
    if (!currentFileId) {
      quickAction("Please load a video first");
      return;
    }
    if (segments.length === 0) {
      quickAction("No subtitles to burn");
      return;
    }
    setIsRendering(true);
    quickAction("Rendering video with FFmpeg + libass (this may take a few moments)...");

    try {
      const payload = {
        file_id: currentFileId,
        segments: segments.map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          text: s.original,
          custom_text: s.translated,
          x_pct: s.x,
          y_pct: s.y,
          anchor: s.anchor === "left" ? "\\an4" : s.anchor === "right" ? "\\an6" : "\\an5",
          track_id: s.track + 1,
          outline_color: s.outlineColor,
          text_color: s.textColor,
          bg_color: s.bgColor,
          box_w: s.boxW,
          box_h: s.boxH,
        })),
        style: {
          font_size: fontSize,
          font_name: "Arial",
          mask_mode:
            maskMode === "Fitted box"
              ? "box"
              : maskMode === "Full-width bar"
                ? "full_bar"
                : "outline",
          bg_opacity: opacity / 100,
          bg_padding: padding,
          border_radius: borderRadius,
          outline_color: outlineColor,
          outline_width: outlineWidth,
          text_color: textColor,
          bg_color: bgColor,
          bold,
        },
        reframe_target: reframeTarget,
        reframe_mode: reframeMode,
        flip_horizontal: flipHorizontal,
      };

      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Render failed");
      const data = await res.json();
      setRenderResult(data);
      quickAction("Video render complete! Click download in notification.");
    } catch (err: any) {
      quickAction(`Render error: ${err.message}`);
    } finally {
      setIsRendering(false);
    }
  }

  // --------------------------------------------------------------------------
  // SEGMENT MUTATIONS
  // --------------------------------------------------------------------------
  const updateSelected = useCallback(
    (patch: Partial<Segment>) => {
      if (selectedId === null) return;
      setSegments((items) => {
        const updated = items.map((item) =>
          item.id === selectedId ? { ...item, ...patch } : item,
        );
        pushHistory(updated);
        return updated;
      });
    },
    [selectedId],
  );

  const splitSelected = useCallback(() => {
    if (!selected || playhead <= selected.start + 0.15 || playhead >= selected.end - 0.15) {
      quickAction("Move playhead inside the selected block to split");
      return;
    }
    const nextId = Math.max(0, ...segments.map((s) => s.id)) + 1;
    const updated = [
      ...segments.map((item) => (item.id === selected.id ? { ...item, end: playhead } : item)),
      { ...selected, id: nextId, start: playhead },
    ];
    setSegments(updated);
    pushHistory(updated);
    setSelectedId(nextId);
    quickAction(`Split at ${formatTime(playhead, true)}`);
  }, [selected, playhead, segments]);

  const mergeSelected = useCallback(() => {
    if (!selected) return;

    // 1. Check for simultaneous stacked title/subtitle (e.g. 2 lines occurring at the same time)
    const simultaneous = segments
      .filter((s) => {
        if (s.id === selected.id) return false;
        const overlap = Math.min(s.end, selected.end) - Math.max(s.start, selected.start);
        const duration = Math.min(s.end - s.start, selected.end - selected.start);
        return overlap > 0.5 && overlap >= duration * 0.7;
      })
      .sort((a, b) => Math.abs(a.y - selected.y) - Math.abs(b.y - selected.y))[0];

    if (simultaneous && Math.abs(simultaneous.y - selected.y) < 20) {
      const isSelectedTop = selected.y < simultaneous.y;
      const topSeg = isSelectedTop ? selected : simultaneous;
      const btmSeg = isSelectedTop ? simultaneous : selected;
      const updated = segments
        .filter((s) => s.id !== simultaneous.id)
        .map((s) =>
          s.id === selected.id
            ? {
                ...s,
                start: Math.min(selected.start, simultaneous.start),
                end: Math.max(selected.end, simultaneous.end),
                original: `${topSeg.original}\n${btmSeg.original}`,
                translated: `${topSeg.translated}\n${btmSeg.translated}`,
                y: Math.round(((selected.y + simultaneous.y) / 2) * 10) / 10,
                x: Math.round(((selected.x + simultaneous.x) / 2) * 10) / 10,
                boxH: (selected.boxH || 85) + (simultaneous.boxH || 85),
                boxW: Math.max(selected.boxW || 400, simultaneous.boxW || 400),
              }
            : s,
        );
      setSegments(updated);
      pushHistory(updated);
      scheduleAutoSave(updated);
      quickAction("Stacked lines merged into 1 wrapper");
      return;
    }

    // 2. Otherwise merge sequential adjacent blocks on same track
    const adjacent = segments
      .filter((s) => s.track === selected.track && s.id !== selected.id)
      .sort((a, b) => Math.abs(a.start - selected.end) - Math.abs(b.start - selected.end))[0];
    if (!adjacent || Math.abs(adjacent.start - selected.end) > 2) {
      quickAction("No adjacent or stacked block available to merge");
      return;
    }
    const updated = segments
      .filter((s) => s.id !== adjacent.id)
      .map((s) =>
        s.id === selected.id
          ? {
              ...s,
              end: Math.max(s.end, adjacent.end),
              original: `${s.original} ${adjacent.original}`,
              translated: `${s.translated} ${adjacent.translated}`,
            }
          : s,
      );
    setSegments(updated);
    pushHistory(updated);
    scheduleAutoSave(updated);
    quickAction("Adjacent blocks merged");
  }, [selected, segments]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    const updated = segments.filter((s) => s.id !== selected.id);
    setSegments(updated);
    pushHistory(updated);
    setSelectedId(null);
    quickAction("Segment removed");
  }, [selected, segments]);

  // --------------------------------------------------------------------------
  // KEYBOARD SHORTCUTS
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayPause();
      } else if (event.key === "ArrowLeft") {
        seekToTime(playhead - (event.shiftKey ? 1.0 : 1 / FPS));
      } else if (event.key === "ArrowRight") {
        seekToTime(playhead + (event.shiftKey ? 1.0 : 1 / FPS));
      } else if (event.key.toLowerCase() === "s") {
        splitSelected();
      } else if (event.key.toLowerCase() === "m") {
        mergeSelected();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      } else if (event.key === "Escape") {
        setSelectedId(null);
      } else if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === "+" || event.key === "=") {
        setZoom((z) => Math.min(2.4, z + 0.15));
      } else if (event.key === "-") {
        setZoom((z) => Math.max(0.65, z - 0.15));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [splitSelected, mergeSelected, deleteSelected, playhead, seekToTime]);

  // Status toast auto-dismiss
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function quickAction(message: string) {
    setStatus(message);
  }

  // --------------------------------------------------------------------------
  // TIMELINE DRAG & RESIZE
  // --------------------------------------------------------------------------
  function beginTimelineDrag(
    event: React.PointerEvent,
    segment: Segment,
    kind: NonNullable<DragState>["kind"],
  ) {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      id: segment.id,
      kind,
      originX: event.clientX,
      start: segment.start,
      end: segment.end,
    };
    setSelectedId(segment.id);
  }

  function moveTimelineDrag(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const secondsPerPixel = duration / timelineWidth;
    let delta = (event.clientX - drag.originX) * secondsPerPixel;
    if (snap) delta = Math.round(delta * FPS) / FPS;

    setSegments((items) =>
      items.map((s) => {
        if (s.id !== drag.id) return s;
        if (drag.kind === "move") {
          const segDuration = drag.end - drag.start;
          const start = Math.max(0, Math.min(duration - segDuration, drag.start + delta));
          return { ...s, start, end: start + segDuration };
        }
        if (drag.kind === "trim-start") {
          return { ...s, start: Math.max(0, Math.min(drag.end - 0.2, drag.start + delta)) };
        }
        return { ...s, end: Math.min(duration, Math.max(drag.start + 0.2, drag.end + delta)) };
      }),
    );
  }

  function finishTimelineDrag() {
    if (dragRef.current) {
      dragRef.current = null;
      pushHistory(segments);
    }
  }

  function setPlayheadFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-segment]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left - LABEL_WIDTH;
    seekToTime((localX / timelineWidth) * duration);
    setSelectedId(null); // Clicking empty space on timeline deselects
  }

  // --------------------------------------------------------------------------
  // ON-SCREEN SPATIAL CANVAS DRAG
  // --------------------------------------------------------------------------
  function beginCanvasDrag(event: React.PointerEvent) {
    if (!selected) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    canvasDragRef.current = { x: selected.x, y: selected.y };
  }

  function moveCanvasDrag(event: React.PointerEvent) {
    if (!canvasDragRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = Math.round(
      Math.max(4, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100)),
    );
    const newX = flipHorizontal ? 100 - rawX : rawX;
    const newY = Math.round(
      Math.max(5, Math.min(95, ((event.clientY - rect.top) / rect.height) * 100)),
    );
    updateSelected({ x: newX, y: newY });
  }

  const filteredTranscriptSegments = useMemo(() => {
    if (!transcriptSearch.trim()) return segments;
    const q = transcriptSearch.toLowerCase();
    return segments.filter(
      (s) => s.original.toLowerCase().includes(q) || s.translated.toLowerCase().includes(q),
    );
  }, [segments, transcriptSearch]);

  return (
    <main className="studio-shell">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="video/*"
        onChange={handleFileUpload}
      />

      {/* TOPBAR */}
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Captions size={17} />
          </div>
          <div>
            <strong>Video Subtitle Studio</strong>
            <span>LOCAL WORKSPACE</span>
          </div>
        </div>

        {/* Project Selector Pill */}
        <div className="relative">
          <button
            className="project-name cursor-pointer flex items-center gap-1.5"
            onClick={() => setShowProjectsDropdown((v) => !v)}
            title="Switch Project"
          >
            <Film size={14} />
            <span>{videoFilename}</span>
            <span className="saved-dot">{isSaved ? "Saved" : "Saving..."}</span>
            <ChevronDown size={12} />
          </button>
          {showProjectsDropdown && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-64 bg-popover border border-border rounded shadow-xl z-50 p-1">
              <div className="text-[10px] text-muted-foreground px-2 py-1 uppercase font-semibold">
                Recent Projects
              </div>
              {recentVideos.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2">No projects yet</div>
              ) : (
                recentVideos.map((p) => (
                  <button
                    key={p.file_id}
                    className={cn(
                      "w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary truncate block",
                      currentFileId === p.file_id && "text-primary font-medium",
                    )}
                    onClick={() => {
                      loadProject(p.file_id);
                      setShowProjectsDropdown(false);
                    }}
                  >
                    {(p as any).original_name || p.filename}
                  </button>
                ))
              )}
              <div className="border-t border-border mt-1 pt-1">
                <button
                  className="w-full text-left px-2 py-1.5 text-xs rounded text-primary hover:bg-secondary flex items-center gap-2"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowProjectsDropdown(false);
                  }}
                >
                  <Upload size={12} /> Open new video...
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Topbar Actions */}
        <div className="topbar-actions">
          <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={historyIndex === 0}>
            <Undo2 size={15} />
          </IconButton>
          <IconButton
            label="Redo (Ctrl+Shift+Z)"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
          >
            <Redo2 size={15} />
          </IconButton>
          <span className="topbar-divider" />

          {/* Export Subtitles Dropdown */}
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowExportMenu((v) => !v)}>
              <Download size={14} /> Export subtitles <ChevronDown size={12} />
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded shadow-xl z-50 p-1">
                <button
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary block"
                  onClick={() => exportSubtitles("srt")}
                >
                  SubRip (.srt)
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary block"
                  onClick={() => exportSubtitles("ass")}
                >
                  Advanced SSA (.ass)
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary block"
                  onClick={() => exportSubtitles("json")}
                >
                  JSON format (.json)
                </button>
              </div>
            )}
          </div>

          {/* Burn & Export Dropdown & Modal Trigger */}
          <div className="relative">
            <Button
              size="sm"
              onClick={() => {
                if (!currentFileId) {
                  quickAction("Please select or upload a video first");
                  fileInputRef.current?.click();
                  return;
                }
                setShowBurnMenu((v) => !v);
              }}
              disabled={isRendering}
              className="gap-1.5 cursor-pointer shadow-sm"
              title="Select format (TikTok, YouTube, Original) to burn & export video"
            >
              <Sparkle size={14} />{" "}
              {isRendering
                ? "Burning video..."
                : reframeTarget === "tiktok"
                  ? "Burn: TikTok (9:16)"
                  : reframeTarget === "youtube"
                    ? "Burn: YouTube (16:9)"
                    : "Burn & export video"}
              <ChevronDown
                size={12}
                className={cn(
                  "transition-transform duration-200",
                  showBurnMenu ? "rotate-180" : "",
                )}
              />
            </Button>

            {/* Backdrop to close menu when clicking outside */}
            {showBurnMenu && (
              <div className="fixed inset-0 z-40" onClick={() => setShowBurnMenu(false)} />
            )}

            {/* Dropdown Menu for selecting platform */}
            {showBurnMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-border bg-popover/98 backdrop-blur-md p-2 shadow-2xl z-50 animate-in fade-in-50 zoom-in-95 text-foreground">
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                  <span>Select Export Target</span>
                  <span className="text-[10px] text-editor-teal font-medium">choose format</span>
                </div>

                <div className="space-y-1 mt-1">
                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors cursor-pointer",
                      reframeTarget === "tiktok"
                        ? "bg-editor-teal/15 border border-editor-teal/30 text-foreground"
                        : "hover:bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setReframeTarget("tiktok");
                      setShowSafeZones(true);
                      setShowBurnMenu(false);
                      setShowBurnModal(true);
                    }}
                  >
                    <Smartphone size={17} className="text-editor-teal mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-foreground flex items-center justify-between">
                        <span>TikTok / Shorts (9:16)</span>
                        <span className="text-[10px] font-mono text-editor-teal">1080×1920</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        Vertical full-screen · Smart blur or crop fill
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors cursor-pointer",
                      reframeTarget === "youtube"
                        ? "bg-editor-teal/15 border border-editor-teal/30 text-foreground"
                        : "hover:bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setReframeTarget("youtube");
                      setShowBurnMenu(false);
                      setShowBurnModal(true);
                    }}
                  >
                    <Monitor size={17} className="text-editor-teal mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-foreground flex items-center justify-between">
                        <span>YouTube (16:9)</span>
                        <span className="text-[10px] font-mono text-editor-teal">1920×1080</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        Standard widescreen landscape format
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors cursor-pointer",
                      reframeTarget === "original"
                        ? "bg-editor-teal/15 border border-editor-teal/30 text-foreground"
                        : "hover:bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setReframeTarget("original");
                      setShowBurnMenu(false);
                      setShowBurnModal(true);
                    }}
                  >
                    <Film size={17} className="text-editor-teal mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-foreground flex items-center justify-between">
                        <span>Original Aspect Ratio</span>
                        <span className="text-[10px] font-mono text-muted-foreground">Native</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        Burn subtitles directly onto original resolution
                      </div>
                    </div>
                  </button>
                </div>

                <div className="my-1.5 border-t border-border" />

                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
                  onClick={() => {
                    setShowBurnMenu(false);
                    setShowBurnModal(true);
                  }}
                >
                  <Settings2 size={14} className="text-muted-foreground" />
                  <span>Customize framing & safe zones...</span>
                </button>
              </div>
            )}
          </div>
          <IconButton label="Workspace menu" onClick={() => quickAction("Workspace menu ready")}>
            <Menu size={16} />
          </IconButton>
        </div>
      </header>

      {/* WORKSPACE 4-PANE GRID */}
      <section
        className={cn(
          "workspace",
          !leftOpen && "left-collapsed",
          !rightOpen && "right-collapsed",
          !timelineOpen && "timeline-collapsed",
        )}
      >
        {/* LEFT DOCK: MEDIA & TRANSCRIPT */}
        <aside className="source-panel panel">
          <div className="panel-tabs">
            <button
              className={cn(sourceTab === "media" && "active")}
              onClick={() => setSourceTab("media")}
            >
              Media
            </button>
            <button
              className={cn(sourceTab === "transcript" && "active")}
              onClick={() => setSourceTab("transcript")}
            >
              Transcript
            </button>
            <IconButton label="Collapse source panel" onClick={() => setLeftOpen(false)}>
              <ChevronLeft size={14} />
            </IconButton>
          </div>

          {sourceTab === "transcript" ? (
            <>
              <div className="source-toolbar">
                <div className="search-box">
                  <Search size={13} />
                  <input
                    aria-label="Search transcript"
                    placeholder="Search transcript"
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                  />
                </div>
                <IconButton label="Import video" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} />
                </IconButton>
              </div>

              {/* Extraction Strip */}
              <div className="extractor-strip">
                <button
                  className={cn("extractor", isAnalyzing && "opacity-50")}
                  onClick={() => runExtraction("OCR")}
                  disabled={isAnalyzing}
                  title="Extract On-Screen Subtitles with EasyOCR"
                >
                  <Eye size={14} />
                  <span>
                    Screen OCR<small>2D bands</small>
                  </span>
                </button>
                <button
                  className={cn("extractor", isAnalyzing && "opacity-50")}
                  onClick={() => runExtraction("WHISPER")}
                  disabled={isAnalyzing}
                  title="Transcribe Audio Speech with Whisper"
                >
                  <Mic2 size={14} />
                  <span>
                    Whisper<small>Auto language</small>
                  </span>
                </button>
              </div>

              {/* Real-Time Extraction Progress Card */}
              {(extractionProgress.isRunning || extractionProgress.percent > 0) && (
                <div className="mx-2 my-1.5 p-2.5 rounded-md border border-editor-teal/40 bg-panel-raised shadow-sm space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      {extractionProgress.isRunning ? (
                        <Loader2 size={13} className="animate-spin text-editor-teal" />
                      ) : extractionProgress.status === "error" ? (
                        <span className="w-2 h-2 rounded-full bg-destructive" />
                      ) : (
                        <Check size={13} className="text-emerald-400" />
                      )}
                      <span>{extractionProgress.engine}</span>
                    </div>
                    <span className="font-mono text-xs font-semibold text-editor-teal">
                      {extractionProgress.percent}%
                    </span>
                  </div>

                  {/* Animated Progress Bar Track */}
                  <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-editor-teal rounded-full transition-all duration-300 ease-out"
                      style={{
                        width: `${Math.min(100, Math.max(0, extractionProgress.percent))}%`,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="truncate pr-2 font-mono text-[10px]">
                      {extractionProgress.stage || "Processing frames..."}
                    </span>
                    {extractionProgress.foundCount > 0 && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-editor-teal/15 text-editor-teal font-mono text-[9px] font-semibold">
                        {extractionProgress.foundCount} detected
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="transcript-summary">
                <span>{segments.length} SEGMENTS</span>
                <span>{targetLang.toUpperCase()} TARGET</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm("Clear all subtitles?")) {
                      setSegments([]);
                      pushHistory([]);
                      setSelectedId(null);
                    }
                  }}
                >
                  <RotateCcw size={12} /> Reset
                </Button>
              </div>

              {/* Transcript List */}
              <div className="transcript-list">
                {filteredTranscriptSegments.map((segment) => {
                  const hasRowTranslation = Boolean(
                    segment.translated &&
                    segment.original &&
                    segment.translated.trim() !== "" &&
                    segment.original.trim() !== "" &&
                    segment.translated.trim() !== segment.original.trim(),
                  );
                  return (
                    <button
                      key={segment.id}
                      className={cn("transcript-row", selectedId === segment.id && "selected")}
                      onClick={() => {
                        setSelectedId(segment.id);
                        seekToTime(segment.start);
                      }}
                    >
                      <div className="transcript-time">
                        <span>{formatTime(segment.start)}</span>
                        <em>{segment.source}</em>
                      </div>
                      <div>
                        <p>{segment.original || segment.translated}</p>
                        {hasRowTranslation && <p className="translated">{segment.translated}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Translation Bridge */}
              <div className="translation-bridge">
                <div>
                  <Languages size={15} />
                  <strong>AI translation</strong>
                  <select
                    className="bg-transparent text-[10px] text-muted-foreground outline-none cursor-pointer border border-border rounded px-1"
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                  >
                    {SUPPORTED_TARGET_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between p-1.5 bg-secondary/50 rounded-md border border-border/60 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={thinkingMode}
                      onChange={(e) => setThinkingMode(e.target.checked)}
                      className="accent-editor-teal rounded"
                    />
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <Brain
                        size={13}
                        className={thinkingMode ? "text-editor-teal" : "text-muted-foreground"}
                      />
                      Thinking Mode
                    </span>
                  </label>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-editor-teal/15 text-editor-teal font-semibold">
                    R1 / o1 / Thinking
                  </span>
                </div>
                <div className="bridge-actions grid grid-cols-3 gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => launchAiTranslation("chatgpt")}
                    title="Open ChatGPT in new tab & auto-submit"
                  >
                    <Bot size={13} /> ChatGPT
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => launchAiTranslation("claude")}
                    title="Open Claude in new tab & auto-submit"
                  >
                    Claude
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => launchAiTranslation("deepseek")}
                    title="Open DeepSeek in new tab & auto-submit"
                  >
                    DeepSeek
                  </Button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
                  <span className="truncate">Opens tab & auto-submits via extension</span>
                  <button
                    type="button"
                    className="text-editor-teal hover:underline font-mono text-[9px] cursor-pointer shrink-0"
                    onClick={() => setShowExtensionModal(true)}
                  >
                    Extension guide
                  </button>
                </div>
                <Button size="sm" onClick={batchTranslate} disabled={isTranslating}>
                  <Wand2 size={13} />{" "}
                  {isTranslating ? "Translating..." : "Batch translate all (Local)"}
                </Button>
              </div>
            </>
          ) : (
            <div
              className="media-bin"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={handleFileDrop}
            >
              <div className="media-thumb">
                {videoUrl ? (
                  <video src={videoUrl} className="w-full h-full object-cover" />
                ) : (
                  <img src={previewImage} alt="Video preview thumbnail" width={1536} height={864} />
                )}
                <span>{formatTime(duration)}</span>
              </div>
              <strong>{videoFilename}</strong>
              <div className="flex flex-col gap-1.5 w-full mt-1">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                >
                  <FolderOpen size={14} /> Replace source
                </Button>
                <Button
                  variant={flipHorizontal ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "w-full gap-1.5 text-xs",
                    flipHorizontal &&
                      "bg-editor-teal hover:bg-editor-teal/90 text-white font-semibold",
                  )}
                  onClick={toggleFlipHorizontal}
                  title="Mirror video horizontally · Preserves transcript OCR"
                >
                  <FlipHorizontal size={14} />
                  {flipHorizontal ? "Video Flipped (Mirrored)" : "Flip Video (Horizontal)"}
                </Button>
              </div>
            </div>
          )}
        </aside>

        {!leftOpen && (
          <button
            className="panel-restore left"
            onClick={() => setLeftOpen(true)}
            title="Show source panel"
          >
            <ChevronRight size={15} />
          </button>
        )}

        {/* CENTER VIEWPORT (PROGRAM MONITOR) */}
        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <div className="flex items-center gap-2 flex-wrap">
              <span>PROGRAM</span>
              <span className="viewer-resolution">
                {reframeTarget === "tiktok"
                  ? "9:16 · TikTok"
                  : reframeTarget === "youtube"
                    ? "16:9 · YouTube"
                    : "Original"}
              </span>

              {/* Platform Reframe Selector */}
              <div className="flex items-center bg-background/80 border border-border rounded-md p-0.5 ml-1 gap-0.5 text-[10px]">
                <button
                  type="button"
                  className={cn(
                    "px-2 py-0.5 rounded transition-colors flex items-center gap-1",
                    reframeTarget === "original"
                      ? "bg-editor-teal/20 text-editor-teal font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setReframeTarget("original")}
                  title="Original Aspect Ratio"
                >
                  Original
                </button>
                <button
                  type="button"
                  className={cn(
                    "px-2 py-0.5 rounded transition-colors flex items-center gap-1",
                    reframeTarget === "tiktok"
                      ? "bg-editor-teal/20 text-editor-teal font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    setReframeTarget("tiktok");
                    setShowSafeZones(true);
                    setShowTikTokUI(true);
                  }}
                  title="Auto Reframe for TikTok / Shorts / Reels (9:16 Vertical)"
                >
                  <Smartphone size={11} /> TikTok (9:16)
                </button>
                <button
                  type="button"
                  className={cn(
                    "px-2 py-0.5 rounded transition-colors flex items-center gap-1",
                    reframeTarget === "youtube"
                      ? "bg-editor-teal/20 text-editor-teal font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setReframeTarget("youtube")}
                  title="Auto Reframe for YouTube Widescreen (16:9)"
                >
                  <Monitor size={11} /> YouTube (16:9)
                </button>
              </div>

              {/* Framing Mode (when reframed) */}
              {reframeTarget !== "original" && (
                <div className="flex items-center bg-background/80 border border-border rounded-md p-0.5 gap-0.5 text-[10px]">
                  <button
                    type="button"
                    className={cn(
                      "px-1.5 py-0.5 rounded transition-colors",
                      reframeMode === "blur"
                        ? "bg-editor-teal/20 text-editor-teal font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setReframeMode("blur")}
                    title="Blur Background: Keep entire video in center with smart blurred duplicate background"
                  >
                    Blur BG
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "px-1.5 py-0.5 rounded transition-colors",
                      reframeMode === "crop"
                        ? "bg-editor-teal/20 text-editor-teal font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setReframeMode("crop")}
                    title="Crop to Fill: Center crop video to fill the full frame"
                  >
                    Crop Fill
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "px-1.5 py-0.5 rounded transition-colors",
                      reframeMode === "fit"
                        ? "bg-editor-teal/20 text-editor-teal font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setReframeMode("fit")}
                    title="Fit: Letterbox with black bars"
                  >
                    Black Bars
                  </button>
                </div>
              )}

              {/* Flip Video (Horizontal Mirror) Toggle */}
              <button
                type="button"
                className={cn(
                  "shrink-0 px-2 py-0.5 rounded border transition-colors flex items-center gap-1 cursor-pointer text-[10px]",
                  flipHorizontal
                    ? "bg-editor-teal/20 border-editor-teal/40 text-editor-teal font-semibold shadow-xs"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground hover:bg-secondary",
                )}
                onClick={toggleFlipHorizontal}
                title={
                  flipHorizontal
                    ? "Video is horizontally mirrored (Transcript OCR preserved). Click to revert."
                    : "Flip video horizontally (Mirror) · Preserves transcript OCR"
                }
              >
                <FlipHorizontal size={11} className={flipHorizontal ? "text-editor-teal" : ""} />
                <span>{flipHorizontal ? "Flipped (Mirrored)" : "Flip Video"}</span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              {/* Subtitle Positioning Presets for TikTok */}
              {reframeTarget === "tiktok" && (
                <div className="flex items-center gap-1 mr-2 text-[10px]">
                  <span className="text-white/40 text-[9px] mr-0.5">Layout:</span>
                  <button
                    type="button"
                    className="px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-[9px]"
                    onClick={() => {
                      setSegments((prev) => prev.map((s) => (s.y >= 65 ? { ...s, y: 76 } : s)));
                      quickAction("Subtitles placed at TikTok Safe Lower Third (76%)");
                    }}
                    title="Move dialogue subtitles to TikTok Safe Zone (Y: 76%)"
                  >
                    TikTok Safe (76%)
                  </button>
                  <button
                    type="button"
                    className="px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-[9px]"
                    onClick={() => {
                      setSegments((prev) => prev.map((s) => (s.y >= 65 ? { ...s, y: 50 } : s)));
                      quickAction("Subtitles placed at Center Hook (50%)");
                    }}
                    title="Move subtitles to Center Hook (Y: 50%)"
                  >
                    Center (50%)
                  </button>
                  {reframeMode === "blur" && (
                    <button
                      type="button"
                      className="px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-[9px]"
                      onClick={() => {
                        setSegments((prev) => prev.map((s) => (s.y >= 65 ? { ...s, y: 62 } : s)));
                        quickAction("Subtitles aligned over original centered video (62%)");
                      }}
                      title="Align over original video box (Y: 62%)"
                    >
                      Mask Original (62%)
                    </button>
                  )}
                </div>
              )}

              <IconButton
                label={
                  reframeTarget === "tiktok"
                    ? showSafeZones
                      ? showTikTokUI
                        ? "TikTok UI Preview ON (Click for Grid)"
                        : "Safe Zone Grid ON (Click to Hide)"
                      : "Safe Zones OFF (Click to Show)"
                    : showSafeZones
                      ? "Hide Safe Zones"
                      : "Show Safe Zones"
                }
                active={showSafeZones}
                onClick={() => {
                  if (reframeTarget === "tiktok") {
                    if (!showSafeZones) {
                      setShowSafeZones(true);
                      setShowTikTokUI(true);
                    } else if (showTikTokUI) {
                      setShowTikTokUI(false);
                    } else {
                      setShowSafeZones(false);
                      setShowTikTokUI(true);
                    }
                  } else {
                    setShowSafeZones((v) => !v);
                  }
                }}
              >
                <Settings2 size={14} />
              </IconButton>
              <IconButton
                label="Fullscreen"
                onClick={() => {
                  if (canvasRef.current) {
                    if (document.fullscreenElement) document.exitFullscreen();
                    else canvasRef.current.requestFullscreen();
                  }
                }}
              >
                <Maximize2 size={14} />
              </IconButton>
            </div>
          </div>

          <div
            className="stage-wrap"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={handleFileDrop}
            onClick={(e) => {
              // Clicking outside of subtitle overlays deselects active segment
              if (
                !(e.target as HTMLElement).closest(".subtitle-overlay") &&
                !(e.target as HTMLElement).closest(".overlay-bounds")
              ) {
                setSelectedId(null);
              }
            }}
          >
            <div
              ref={canvasRef}
              className={cn(
                "video-stage",
                reframeTarget === "tiktok" && "reframe-tiktok",
                reframeTarget === "youtube" && "reframe-youtube",
              )}
              style={{
                aspectRatio:
                  reframeTarget === "original" && videoNaturalAspect
                    ? videoNaturalAspect
                    : undefined,
              }}
            >
              {videoUrl ? (
                <>
                  {/* Blurred background video when in blur reframe mode */}
                  {reframeTarget !== "original" && reframeMode === "blur" && (
                    <video
                      ref={bgVideoRef}
                      src={videoUrl}
                      aria-hidden="true"
                      muted
                      tabIndex={-1}
                      className="absolute inset-0 w-full h-full object-cover filter blur-xl scale-125 brightness-75 -z-10 pointer-events-none"
                      style={flipHorizontal ? { transform: "scaleX(-1) scale(1.25)" } : undefined}
                    />
                  )}
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    style={flipHorizontal ? { transform: "scaleX(-1)" } : undefined}
                    className={cn(
                      "w-full h-full block",
                      reframeTarget === "original"
                        ? "object-contain bg-black"
                        : reframeMode === "crop"
                          ? "object-cover"
                          : reframeMode === "blur"
                            ? "object-contain relative z-0"
                            : "object-contain bg-black relative z-0",
                    )}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => {
                      setPlaying(true);
                      if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
                    }}
                    onPause={() => {
                      setPlaying(false);
                      if (bgVideoRef.current) bgVideoRef.current.pause();
                    }}
                    onEnded={() => {
                      setPlaying(false);
                      if (bgVideoRef.current) bgVideoRef.current.pause();
                    }}
                  />
                </>
              ) : (
                <img src={previewImage} alt="Video preview stage" width={1536} height={864} />
              )}

              {/* Floating Real-time HUD Progress Banner */}
              {extractionProgress.isRunning && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/85 backdrop-blur-md border border-editor-teal/40 shadow-2xl pointer-events-none">
                  <div className="flex items-center gap-2 text-xs font-medium text-white">
                    <Loader2 size={13} className="animate-spin text-editor-teal" />
                    <span>{extractionProgress.engine}</span>
                    <span className="text-white/40">·</span>
                    <span className="font-mono text-editor-teal font-bold">
                      {extractionProgress.percent}%
                    </span>
                    {extractionProgress.foundCount > 0 && (
                      <>
                        <span className="text-white/40">·</span>
                        <span className="text-emerald-400 font-mono text-[11px] font-semibold">
                          {extractionProgress.foundCount} detected
                        </span>
                      </>
                    )}
                  </div>
                  <div className="w-44 h-1 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-editor-teal transition-all duration-300 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, extractionProgress.percent))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Safe Zones Overlay */}
              {showSafeZones &&
                (reframeTarget === "tiktok" ? (
                  <>
                    <div className="tiktok-safe-zone" title="TikTok Safe Viewing Area" />
                    {showTikTokUI && (
                      <div className="tiktok-ui-overlay">
                        <div className="tiktok-ui-top">
                          <span className="opacity-60 text-xs">Following</span>
                          <span className="font-bold border-b-2 border-white pb-0.5">For You</span>
                        </div>
                        <div className="tiktok-ui-right">
                          <div className="tiktok-ui-right-item">
                            <div className="w-9 h-9 rounded-full bg-white/25 border border-white/40 flex items-center justify-center font-bold text-xs">
                              ✦
                            </div>
                          </div>
                          <div className="tiktok-ui-right-item">
                            <Heart size={24} className="fill-white/90 text-white drop-shadow-md" />
                            <span>84.2K</span>
                          </div>
                          <div className="tiktok-ui-right-item">
                            <MessageCircle
                              size={24}
                              className="fill-white/90 text-white drop-shadow-md"
                            />
                            <span>1,248</span>
                          </div>
                          <div className="tiktok-ui-right-item">
                            <Bookmark
                              size={24}
                              className="fill-white/90 text-white drop-shadow-md"
                            />
                            <span>9.4K</span>
                          </div>
                          <div className="tiktok-ui-right-item">
                            <Share2 size={24} className="fill-white/90 text-white drop-shadow-md" />
                            <span>3.8K</span>
                          </div>
                          <div className="tiktok-ui-right-item mt-1">
                            <div
                              className="w-8 h-8 rounded-full bg-black/70 border-2 border-white/40 flex items-center justify-center animate-spin"
                              style={{ animationDuration: "4s" }}
                            >
                              <Music size={14} className="text-white/80" />
                            </div>
                          </div>
                        </div>
                        <div className="tiktok-ui-bottom">
                          <span className="author">@creator</span>
                          <span className="caption truncate">
                            {videoFilename || "Original Video"} · #fyp #viral
                          </span>
                          <div className="sound">
                            <Music size={11} />
                            <span className="truncate">Original Sound - Trending Audio</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="safe-zone safe-zone-outer" title="Action Safe (90%)" />
                    <div className="safe-zone safe-zone-inner" title="Title Safe (80%)" />
                  </>
                ))}

              <div className="canvas-center-line horizontal" />
              <div className="canvas-center-line vertical" />

              {/* Active Subtitle Overlays (With Collision Avoidance) */}
              {positionedActiveSegments.map((segment) => {
                const isSelected = segment.id === selectedId;
                const isLeft = flipHorizontal
                  ? segment.anchor === "right"
                  : segment.anchor === "left";
                const isRight = flipHorizontal
                  ? segment.anchor === "left"
                  : segment.anchor === "right";
                const justify = isLeft
                  ? "translateX(0)"
                  : isRight
                    ? "translateX(-100%)"
                    : "translateX(-50%)";
                const effectiveX = flipHorizontal ? 100 - (segment.x ?? 50) : (segment.x ?? 50);
                const leftPos = `${effectiveX}%`;
                const textToShow =
                  segment.translated !== undefined && segment.translated !== null
                    ? segment.translated
                    : segment.original;
                if (!textToShow.trim()) return null;

                const isSideSticker =
                  segment.track === 2 || ((segment.x < 30 || segment.x > 70) && segment.y < 70);
                const isTitleHeader = segment.track === 0 || (segment.y < 70 && !isSideSticker);
                const isTitle = isTitleHeader || isSideSticker;

                const hasSimultaneousSideStickers =
                  isTitleHeader &&
                  activeSegments.some(
                    (other) =>
                      other.id !== segment.id &&
                      (other.x < 30 || other.x > 70) &&
                      other.y < 70 &&
                      Math.abs(other.y - segment.y) < 15,
                  );

                const segBg = segment.bgColor || bgColor || "#000000";
                const segOutline = segment.outlineColor || outlineColor || segBg;
                const segText = segment.textColor || textColor || getContrastTextColor(segBg);

                const yPos = segment.displayY !== undefined ? segment.displayY : segment.y;

                const hasExplicitNewline = textToShow.includes("\n");
                let formattedTitle = textToShow;
                if (
                  isTitleHeader &&
                  !hasExplicitNewline &&
                  yPos <= 28 &&
                  (textToShow.length > 28 || (segment.boxH && segment.boxH > 100))
                ) {
                  const words = textToShow.split(" ");
                  if (words.length >= 3) {
                    const mid = Math.floor(textToShow.length / 2);
                    let bestIdx = -1;
                    let bestDist = 9999;
                    let running = 0;
                    for (let i = 0; i < words.length - 1; i++) {
                      running += words[i].length + 1;
                      const dist = Math.abs(running - mid);
                      if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = i;
                      }
                    }
                    if (bestIdx >= 0) {
                      formattedTitle =
                        words.slice(0, bestIdx + 1).join(" ") +
                        "\n" +
                        words.slice(bestIdx + 1).join(" ");
                    }
                  }
                }
                const isMultiLineTitle =
                  isTitleHeader && (hasExplicitNewline || formattedTitle.includes("\n"));
                const textToDisplay = isTitleHeader ? formattedTitle : textToShow;

                let currentFontSize: number;
                let padVert: number;
                let padHoriz: number;
                let boxRadius: number;

                if (isSideSticker) {
                  currentFontSize = 10;
                  padVert = 3;
                  padHoriz = 6;
                  boxRadius = 5;
                } else if (isTitleHeader) {
                  const maxHeaderChars = hasSimultaneousSideStickers ? 130 : 250;
                  const isLong = textToDisplay.length > 20;
                  const targetFs = Math.floor(maxHeaderChars / (textToDisplay.length * 0.52 + 1.5));
                  currentFontSize = Math.max(9, Math.min(isLong ? 11 : 13, targetFs));
                  padVert = isMultiLineTitle ? 6 : 4;
                  padHoriz = 10;
                  boxRadius = 6;
                } else {
                  currentFontSize = Math.min(fontSize, 18);
                  padVert = Math.max(4, Math.round(padding * 0.5));
                  padHoriz = Math.max(10, Math.round(padding * 1.0));
                  boxRadius = borderRadius >= 50 ? 9999 : Math.min(borderRadius, 14);
                }

                const isDialogue = !isTitleHeader && !isSideSticker && yPos >= 70;
                const effectiveMaskMode = isDialogue
                  ? maskMode
                  : maskMode === "Text outline"
                    ? "Text outline"
                    : "Fitted box";

                return (
                  <div
                    key={segment.id}
                    className={cn(
                      "subtitle-overlay cursor-pointer",
                      isSelected && "selected",
                      isTitleHeader && "title-overlay",
                      isSideSticker && "callout-overlay",
                    )}
                    style={{
                      left: leftPos,
                      top: `${yPos}%`,
                      transform: "translate(-50%, -50%)",
                      fontSize: `${currentFontSize}px`,
                      fontWeight: bold ? 700 : 600,
                      lineHeight: 1.35,
                      textAlign:
                        segment.anchor === "left"
                          ? "left"
                          : segment.anchor === "right"
                            ? "right"
                            : "center",
                      zIndex: isSelected ? 40 : 25,
                      width: "max-content",
                      maxWidth:
                        isTitleHeader && hasSimultaneousSideStickers
                          ? "48%"
                          : isTitle
                            ? "96%"
                            : "92%",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(segment.id);
                    }}
                  >
                    {/* Clean single-layer styled subtitle box - 100% solid, not clear */}
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          effectiveMaskMode === "Fitted box" ||
                          effectiveMaskMode === "Full-width bar"
                            ? `rgba(${hexToRgb(segBg)}, 1)`
                            : "transparent",
                        padding:
                          effectiveMaskMode === "Fitted box"
                            ? `${padVert}px ${padHoriz}px`
                            : effectiveMaskMode === "Full-width bar"
                              ? `${padding}px 16px`
                              : "4px 8px",
                        minWidth: effectiveMaskMode === "Full-width bar" ? "100%" : undefined,
                        minHeight: isTitleHeader ? (isMultiLineTitle ? "54px" : "24px") : undefined,
                        borderRadius:
                          effectiveMaskMode === "Fitted box"
                            ? boxRadius >= 50
                              ? "9999px"
                              : `${boxRadius}px`
                            : "0px",
                        border:
                          effectiveMaskMode === "Fitted box" && outlineWidth > 0
                            ? `${Math.min(outlineWidth, isSideSticker ? 1 : 2)}px solid ${segOutline}`
                            : "none",
                        color: segText,
                        maxWidth:
                          isTitleHeader && hasSimultaneousSideStickers
                            ? "48%"
                            : isTitle
                              ? "96%"
                              : "92%",
                        width: "max-content",
                        whiteSpace: isTitleHeader || hasExplicitNewline ? "pre-wrap" : "nowrap",
                        overflowWrap: "break-word",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                      }}
                    >
                      {textToDisplay}
                    </span>

                    {/* Transform Bounding Box (Only rendered when selected AND active at playhead) */}
                    {isSelected && (
                      <button
                        className="overlay-bounds"
                        aria-label="Drag subtitle position"
                        onPointerDown={beginCanvasDrag}
                        onPointerMove={moveCanvasDrag}
                        onPointerUp={() => {
                          canvasDragRef.current = null;
                        }}
                      >
                        <i className="handle tl" />
                        <i className="handle tr" />
                        <i className="handle bl" />
                        <i className="handle br" />
                        <b>
                          {Math.round(segment.x)}%, {Math.round(segment.y)}%
                        </b>
                      </button>
                    )}
                  </div>
                );
              })}

              <div className="canvas-guidance">
                <MousePointer2 size={12} /> Drag selected text to reposition · Click background to
                deselect
              </div>
            </div>
          </div>

          {/* TRANSPORT BAR */}
          <div className="transport">
            <div className="transport-side">
              <Volume2 size={14} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-16 accent-teal-400 h-1 cursor-pointer"
                title="Volume"
              />
            </div>

            <div className="transport-main">
              <IconButton label="Seek to Start" onClick={() => seekToTime(0)}>
                <ChevronsLeft size={15} />
              </IconButton>
              <IconButton label="Previous frame" onClick={() => seekToTime(playhead - 1 / FPS)}>
                <SkipBack size={15} />
              </IconButton>
              <Button
                className="play-button"
                size="icon"
                onClick={togglePlayPause}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </Button>
              <IconButton label="Next frame" onClick={() => seekToTime(playhead + 1 / FPS)}>
                <SkipForward size={15} />
              </IconButton>
              <IconButton label="Seek to End" onClick={() => seekToTime(duration)}>
                <ChevronsRight size={15} />
              </IconButton>
            </div>

            <div className="transport-side right">
              <button
                onClick={() =>
                  handleSpeedChange(speed === 2 ? 0.5 : speed === 0.5 ? 1 : speed === 1 ? 1.5 : 2)
                }
                title="Playback Speed"
              >
                {speed}×
              </button>
              <IconButton label="Loop segment" active={loop} onClick={() => setLoop((v) => !v)}>
                <RotateCcw size={14} />
              </IconButton>
              <IconButton
                label={
                  flipHorizontal
                    ? "Video Horizontally Flipped (Mirror ON). Click to revert."
                    : "Flip Video Horizontally (Mirror). Preserves transcript OCR."
                }
                active={flipHorizontal}
                onClick={toggleFlipHorizontal}
              >
                <FlipHorizontal size={14} />
              </IconButton>
            </div>
          </div>
        </section>

        {/* RIGHT DOCK: INSPECTOR & STYLE */}
        <aside className="inspector-panel panel">
          <div className="panel-tabs">
            <button
              className={cn(inspectorTab === "segment" && "active")}
              onClick={() => setInspectorTab("segment")}
            >
              Inspector
            </button>
            <button
              className={cn(inspectorTab === "style" && "active")}
              onClick={() => setInspectorTab("style")}
            >
              Style
            </button>
            <IconButton label="Collapse inspector" onClick={() => setRightOpen(false)}>
              <ChevronRight size={14} />
            </IconButton>
          </div>

          {inspectorTab === "style" || selected ? (
            inspectorTab === "segment" && selected ? (
              <div className="inspector-content">
                <div className="selection-heading">
                  <div className={cn("source-icon", selected.source.toLowerCase())}>
                    {selected.source === "OCR" ? <Eye size={14} /> : <Mic2 size={14} />}
                  </div>
                  <div>
                    <strong>Segment {String(selected.id).padStart(2, "0")}</strong>
                    <span>
                      {selected.source} · Track {selected.track + 1}
                    </span>
                  </div>
                  <span className="sync-state">
                    <Link2 size={11} /> Synced
                  </span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded ml-1"
                    title="Deselect Segment (Esc)"
                    onClick={() => setSelectedId(null)}
                  >
                    ✕
                  </button>
                </div>

                <section className="property-section">
                  <h3>Timing</h3>
                  <div className="field-grid three">
                    <label>
                      <FieldLabel>Start</FieldLabel>
                      <input
                        value={formatTime(selected.start, true)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) updateSelected({ start: val });
                        }}
                      />
                    </label>
                    <label>
                      <FieldLabel>End</FieldLabel>
                      <input
                        value={formatTime(selected.end, true)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) updateSelected({ end: val });
                        }}
                      />
                    </label>
                    <label>
                      <FieldLabel>Duration</FieldLabel>
                      <input value={`${(selected.end - selected.start).toFixed(2)}s`} readOnly />
                    </label>
                  </div>
                </section>

                <section className="property-section">
                  <h3>Content</h3>
                  {(() => {
                    const hasTranslation = Boolean(
                      selected.translated &&
                      selected.original &&
                      selected.translated.trim() !== "" &&
                      selected.original.trim() !== "" &&
                      selected.translated.trim() !== selected.original.trim(),
                    );
                    const targetLangLabel = getLanguageLabel(targetLang);

                    if (!hasTranslation) {
                      // Text without translation / without transcript separation
                      const currentText = selected.translated || selected.original || "";
                      return (
                        <>
                          <label>
                            <FieldLabel>
                              Subtitle text {selected.source ? `· ${selected.source}` : ""}
                            </FieldLabel>
                            <textarea
                              className="translation-input"
                              placeholder="Enter subtitle text..."
                              value={currentText}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateSelected({ original: val, translated: val });
                              }}
                            />
                          </label>
                          <div className="inline-actions flex items-center justify-between gap-2 mt-1">
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={translateSingleSelected}
                                disabled={isTranslating}
                                title={`Translate text to ${targetLangLabel}`}
                              >
                                <Wand2 size={12} /> Translate to {targetLangLabel}
                              </Button>
                              <select
                                className="bg-transparent text-[10px] text-muted-foreground outline-none cursor-pointer border border-border rounded px-1.5 py-1"
                                value={targetLang}
                                onChange={(e) => setTargetLang(e.target.value)}
                                title="Target language"
                              >
                                {SUPPORTED_TARGET_LANGUAGES.map((l) => (
                                  <option key={l.code} value={l.code}>
                                    {l.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {currentText.length} chars
                            </span>
                          </div>
                        </>
                      );
                    }

                    // Text has translation
                    return (
                      <>
                        <label>
                          <FieldLabel>
                            Original · detected {selected.source ? `(${selected.source})` : ""}
                          </FieldLabel>
                          <textarea
                            value={selected.original}
                            onChange={(e) => updateSelected({ original: e.target.value })}
                          />
                        </label>
                        <label>
                          <div className="flex items-center justify-between">
                            <FieldLabel>{targetLangLabel} · translated</FieldLabel>
                            <select
                              className="bg-transparent text-[9px] text-muted-foreground outline-none cursor-pointer border border-border rounded px-1 py-0.5 mb-1"
                              value={targetLang}
                              onChange={(e) => setTargetLang(e.target.value)}
                              title="Change target language"
                            >
                              {SUPPORTED_TARGET_LANGUAGES.map((l) => (
                                <option key={l.code} value={l.code}>
                                  {l.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <textarea
                            className="translation-input"
                            value={selected.translated}
                            onChange={(e) => updateSelected({ translated: e.target.value })}
                          />
                        </label>
                        <div className="inline-actions flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={translateSingleSelected}
                              disabled={isTranslating}
                              title={`Re-translate segment to ${targetLangLabel}`}
                            >
                              <Wand2 size={12} /> Translate again
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateSelected({ translated: selected.original })}
                              title="Reset translation to original text"
                            >
                              <RotateCcw size={12} /> Revert
                            </Button>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {selected.translated.length} chars
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </section>

                <section className="property-section">
                  <h3>Position</h3>
                  <div className="field-grid two">
                    <label>
                      <FieldLabel>X position</FieldLabel>
                      <div className="unit-input">
                        <input
                          type="number"
                          value={Math.round(selected.x)}
                          onChange={(e) => updateSelected({ x: Number(e.target.value) })}
                        />
                        <span>%</span>
                      </div>
                    </label>
                    <label>
                      <FieldLabel>Y position</FieldLabel>
                      <div className="unit-input">
                        <input
                          type="number"
                          value={Math.round(selected.y)}
                          onChange={(e) => updateSelected({ y: Number(e.target.value) })}
                        />
                        <span>%</span>
                      </div>
                    </label>
                  </div>
                  <FieldLabel>Smart anchor</FieldLabel>
                  <div className="segmented">
                    <button
                      className={cn(selected.anchor === "left" && "active")}
                      onClick={() => updateSelected({ anchor: "left" })}
                    >
                      <AlignLeft size={14} /> Left <small>\an4</small>
                    </button>
                    <button
                      className={cn(selected.anchor === "center" && "active")}
                      onClick={() => updateSelected({ anchor: "center" })}
                    >
                      <AlignCenter size={14} /> Center <small>\an5</small>
                    </button>
                    <button
                      className={cn(selected.anchor === "right" && "active")}
                      onClick={() => updateSelected({ anchor: "right" })}
                    >
                      <AlignRight size={14} /> Right <small>\an6</small>
                    </button>
                  </div>
                </section>
              </div>
            ) : (
              <div className="inspector-content">
                <section className="property-section">
                  <h3>Platform & Auto Reframe</h3>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      className={cn(
                        "px-1 py-1.5 text-[9px] rounded-md border transition-all text-center flex flex-col items-center gap-0.5",
                        reframeTarget === "original"
                          ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                          : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                      onClick={() => setReframeTarget("original")}
                      title="Keep original video aspect ratio"
                    >
                      <span>Original</span>
                      <span className="text-[7px] opacity-70">Native AR</span>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "px-1 py-1.5 text-[9px] rounded-md border transition-all text-center flex flex-col items-center gap-0.5",
                        reframeTarget === "tiktok"
                          ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                          : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                      onClick={() => {
                        setReframeTarget("tiktok");
                        setShowSafeZones(true);
                        setShowTikTokUI(true);
                      }}
                      title="Auto Reframe for TikTok / Shorts / Reels (9:16 Vertical)"
                    >
                      <Smartphone size={12} />
                      <span>TikTok (9:16)</span>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "px-1 py-1.5 text-[9px] rounded-md border transition-all text-center flex flex-col items-center gap-0.5",
                        reframeTarget === "youtube"
                          ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                          : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                      onClick={() => setReframeTarget("youtube")}
                      title="Auto Reframe for YouTube Widescreen (16:9)"
                    >
                      <Monitor size={12} />
                      <span>YouTube (16:9)</span>
                    </button>
                  </div>

                  {reframeTarget !== "original" && (
                    <div className="space-y-1.5 pt-1">
                      <FieldLabel>Framing Mode</FieldLabel>
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            reframeMode === "blur"
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setReframeMode("blur")}
                        >
                          Blur BG
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            reframeMode === "crop"
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setReframeMode("crop")}
                        >
                          Crop Fill
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            reframeMode === "fit"
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setReframeMode("fit")}
                        >
                          Black Bars
                        </button>
                      </div>

                      {reframeTarget === "tiktok" && (
                        <div className="pt-1">
                          <FieldLabel>Caption Position Presets</FieldLabel>
                          <div className="grid grid-cols-3 gap-1 mt-0.5">
                            <button
                              type="button"
                              className="px-1 py-1 text-[8px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-center"
                              onClick={() => {
                                setSegments((prev) =>
                                  prev.map((s) => (s.y >= 65 ? { ...s, y: 76 } : s)),
                                );
                                quickAction("Subtitles placed at TikTok Safe Lower Third (76%)");
                              }}
                            >
                              Safe (76%)
                            </button>
                            <button
                              type="button"
                              className="px-1 py-1 text-[8px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-center"
                              onClick={() => {
                                setSegments((prev) =>
                                  prev.map((s) => (s.y >= 65 ? { ...s, y: 50 } : s)),
                                );
                                quickAction("Subtitles placed at Center Hook (50%)");
                              }}
                            >
                              Center (50%)
                            </button>
                            <button
                              type="button"
                              className="px-1 py-1 text-[8px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-center"
                              onClick={() => {
                                setSegments((prev) =>
                                  prev.map((s) => (s.y >= 65 ? { ...s, y: 62 } : s)),
                                );
                                quickAction("Subtitles aligned over centered original video (62%)");
                              }}
                            >
                              Mask (62%)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="property-section">
                  <h3>Video Transform</h3>
                  <div className="flex items-center justify-between p-2 rounded-md border border-border bg-secondary/30">
                    <div className="flex items-center gap-2">
                      <FlipHorizontal
                        size={16}
                        className={flipHorizontal ? "text-editor-teal" : "text-muted-foreground"}
                      />
                      <div>
                        <div className="text-xs font-medium text-foreground">
                          Flip Video (Mirror)
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Horizontally mirror video · preserves transcript OCR
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={cn(
                        "px-2.5 py-1 text-xs rounded font-medium transition-colors cursor-pointer shrink-0",
                        flipHorizontal
                          ? "bg-editor-teal text-white font-semibold"
                          : "bg-background border border-border text-foreground hover:bg-secondary",
                      )}
                      onClick={toggleFlipHorizontal}
                    >
                      {flipHorizontal ? "Flipped" : "Flip Video"}
                    </button>
                  </div>
                </section>

                <section className="property-section">
                  <h3>Mask & background</h3>
                  <label>
                    <FieldLabel>Mask mode</FieldLabel>
                    <select value={maskMode} onChange={(e) => setMaskMode(e.target.value)}>
                      <option>Fitted box</option>
                      <option>Full-width bar</option>
                      <option>Text outline</option>
                    </select>
                  </label>
                  <label>
                    <FieldLabel>
                      Opacity <b>{opacity}%</b>
                    </FieldLabel>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <FieldLabel>
                      Padding <b>{padding}px</b>
                    </FieldLabel>
                    <input
                      type="range"
                      min="0"
                      max="32"
                      value={padding}
                      onChange={(e) => setPadding(Number(e.target.value))}
                    />
                  </label>
                  {maskMode === "Fitted box" && (
                    <div className="space-y-1.5 pt-0.5">
                      <label>
                        <FieldLabel>
                          Corner radius{" "}
                          <b>{borderRadius >= 50 ? "Pill (Capsule)" : `${borderRadius}px`}</b>
                        </FieldLabel>
                        <input
                          type="range"
                          min="0"
                          max="40"
                          value={Math.min(40, borderRadius)}
                          onChange={(e) => setBorderRadius(Number(e.target.value))}
                        />
                      </label>
                      <div className="grid grid-cols-4 gap-1">
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            borderRadius === 0
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setBorderRadius(0)}
                        >
                          Square
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            borderRadius === 8
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setBorderRadius(8)}
                        >
                          Subtle
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            borderRadius === 18
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setBorderRadius(18)}
                        >
                          Rounded
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-1 py-1 text-[9px] rounded-md border transition-all text-center",
                            borderRadius >= 50
                              ? "border-editor-teal text-editor-teal bg-editor-teal/15 font-semibold"
                              : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                          onClick={() => setBorderRadius(999)}
                        >
                          Pill
                        </button>
                      </div>
                    </div>
                  )}
                  {/* ── Colors & Outline ───────────────────────────────── */}
                  <div className="space-y-2 pt-1">
                    {/* Auto-Detect Button */}
                    <button
                      type="button"
                      onClick={handleDetectColors}
                      disabled={isDetectingColors || !currentFileId}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border border-dashed border-editor-teal/60 bg-editor-teal/8 text-editor-teal text-[9px] font-semibold hover:bg-editor-teal/15 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isDetectingColors ? (
                        <>
                          <Loader2 size={11} className="animate-spin" /> Scanning frames...
                        </>
                      ) : (
                        <>
                          <Sparkle size={11} /> Auto-Detect Colors from Video
                        </>
                      )}
                    </button>

                    {/* Background + Text color row */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1">
                        <FieldLabel>Background</FieldLabel>
                        <div className="flex items-center gap-1.5 h-7 px-1.5 rounded-md border border-input bg-background">
                          <input
                            type="color"
                            value={bgColor}
                            onChange={(e) => setBgColor(e.target.value)}
                            className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                          />
                          <span className="font-mono text-[9px] text-muted-foreground flex-1 truncate">
                            {bgColor}
                          </span>
                        </div>
                      </label>
                      <label className="grid gap-1">
                        <FieldLabel>Text color</FieldLabel>
                        <div className="flex items-center gap-1.5 h-7 px-1.5 rounded-md border border-input bg-background">
                          <input
                            type="color"
                            value={textColor}
                            onChange={(e) => setTextColor(e.target.value)}
                            className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                          />
                          <span className="font-mono text-[9px] text-muted-foreground flex-1 truncate">
                            {textColor}
                          </span>
                        </div>
                      </label>
                    </div>

                    {/* Outline color + width */}
                    <label className="grid gap-1">
                      <FieldLabel>Outline / border color</FieldLabel>
                      <div className="flex items-center gap-1.5 h-7 px-1.5 rounded-md border border-input bg-background">
                        <input
                          type="color"
                          value={outlineColor}
                          onChange={(e) => setOutlineColor(e.target.value)}
                          className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                        />
                        <span className="font-mono text-[9px] text-muted-foreground flex-1 truncate">
                          {outlineColor}
                        </span>
                        {/* Live preview swatch */}
                        <span
                          className="w-5 h-5 rounded-full border-2 flex-shrink-0"
                          style={{
                            borderColor: outlineColor,
                            backgroundColor: `${outlineColor}22`,
                          }}
                        />
                      </div>
                    </label>
                    <label className="grid gap-1">
                      <FieldLabel>
                        Outline width <b>{outlineWidth}px</b>
                      </FieldLabel>
                      <input
                        type="range"
                        min="0"
                        max="6"
                        step="1"
                        value={outlineWidth}
                        onChange={(e) => setOutlineWidth(Number(e.target.value))}
                      />
                    </label>

                    {/* Detected palette swatches */}
                    {detectedPalette.length > 0 && (
                      <div className="grid gap-1">
                        <FieldLabel>Detected palette — click to apply as background</FieldLabel>
                        <div className="flex flex-wrap gap-1.5">
                          {detectedPalette.map((c, i) => (
                            <button
                              key={i}
                              type="button"
                              title={c}
                              onClick={() => setBgColor(c)}
                              className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-editor-teal"
                              style={{
                                backgroundColor: c,
                                borderColor: bgColor === c ? "white" : "transparent",
                                boxShadow:
                                  bgColor === c ? `0 0 0 2px ${c}` : "0 1px 3px rgba(0,0,0,0.4)",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="property-section">
                  <h3>Typography</h3>
                  <label>
                    <FieldLabel>Font family</FieldLabel>
                    <select>
                      <option>IBM Plex Sans</option>
                      <option>Arial</option>
                      <option>Segoe UI</option>
                    </select>
                  </label>
                  <div className="field-grid two">
                    <label>
                      <FieldLabel>Size</FieldLabel>
                      <div className="unit-input">
                        <input
                          type="number"
                          value={fontSize}
                          onChange={(e) => setFontSize(Number(e.target.value))}
                        />
                        <span>px</span>
                      </div>
                    </label>
                    <label>
                      <FieldLabel>Weight</FieldLabel>
                      <button
                        className={cn("bold-toggle", bold && "active")}
                        onClick={() => setBold((b) => !b)}
                      >
                        B
                      </button>
                    </label>
                  </div>
                </section>

                <section className="property-section">
                  <h3>Apply style</h3>
                  <Button
                    variant="outline"
                    onClick={() => quickAction("Style applied to all tracks")}
                  >
                    <Layers3 size={13} /> Apply to track
                  </Button>
                  <Button variant="ghost" onClick={() => quickAction("Style preset saved")}>
                    <Plus size={13} /> Save as preset
                  </Button>
                </section>
              </div>
            )
          ) : (
            <div className="empty-inspector">
              <p className="text-sm font-medium">No Segment Selected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click a subtitle block on the timeline or directly on the video to inspect and edit.
              </p>
            </div>
          )}
        </aside>

        {!rightOpen && (
          <button
            className="panel-restore right"
            onClick={() => setRightOpen(true)}
            title="Show inspector"
          >
            <ChevronLeft size={15} />
          </button>
        )}

        {/* BOTTOM TIMELINE */}
        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div className="timeline-title">
              <strong>Timeline</strong>
              <span>{formatTime(playhead, true)}</span>
              <span className="fps">30 FPS</span>
            </div>
            <div className="timeline-tools">
              <IconButton label="Selection tool" active>
                <MousePointer2 size={14} />
              </IconButton>
              <IconButton label="Split at playhead (S)" onClick={splitSelected}>
                <Scissors size={14} />
              </IconButton>
              <IconButton label="Merge adjacent (M)" onClick={mergeSelected}>
                <Link2 size={14} />
              </IconButton>
              <IconButton label="Delete selected (Del)" onClick={deleteSelected}>
                <Trash2 size={14} />
              </IconButton>
              <span className="tool-divider" />
              <Button
                variant={snap ? "active" : "ghost"}
                size="sm"
                onClick={() => setSnap((v) => !v)}
              >
                <GripVertical size={13} /> Snap
              </Button>
              <IconButton
                label="Zoom out (-)"
                onClick={() => setZoom((z) => Math.max(0.65, z - 0.15))}
              >
                <ZoomOut size={14} />
              </IconButton>
              <input
                aria-label="Timeline zoom"
                className="zoom-slider"
                type="range"
                min="0.65"
                max="2.4"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
              <IconButton
                label="Zoom in (+)"
                onClick={() => setZoom((z) => Math.min(2.4, z + 0.15))}
              >
                <ZoomIn size={14} />
              </IconButton>
              <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
              <IconButton
                label={timelineOpen ? "Collapse timeline" : "Expand timeline"}
                onClick={() => setTimelineOpen((v) => !v)}
              >
                <ChevronDown className={cn(!timelineOpen && "rotate-180")} size={14} />
              </IconButton>
            </div>
          </div>

          {timelineOpen && (
            <div className="timeline-scroll" ref={timelineRef}>
              <div
                className="timeline-content"
                style={{ width: LABEL_WIDTH + timelineWidth }}
                onPointerDown={setPlayheadFromPointer}
                onPointerMove={moveTimelineDrag}
                onPointerUp={finishTimelineDrag}
                onPointerCancel={finishTimelineDrag}
              >
                {/* Ruler */}
                <div className="ruler-label">
                  <Clock3 size={13} /> TC
                </div>
                <div className="ruler" style={{ left: LABEL_WIDTH, width: timelineWidth }}>
                  {Array.from({ length: Math.ceil(duration) * 2 + 1 }, (_, i) => i / 2).map(
                    (time) => (
                      <div
                        key={time}
                        className={cn("tick", Number.isInteger(time) && "major")}
                        style={{ left: `${(time / duration) * 100}%` }}
                      >
                        {Number.isInteger(time) && <span>{formatTime(time)}</span>}
                      </div>
                    ),
                  )}
                </div>

                {/* Simulated Audio Waveform */}
                <div
                  className="waveform"
                  style={{ left: LABEL_WIDTH, width: timelineWidth }}
                  aria-label="Audio waveform"
                >
                  {Array.from({ length: 160 }, (_, i) => (
                    <i key={i} style={{ height: `${12 + ((i * 17) % 32)}%` }} />
                  ))}
                  {[3.1, 8.5, 13.6, 19.8]
                    .filter((t) => t < duration)
                    .map((t) => (
                      <b
                        key={t}
                        style={{ left: `${(t / duration) * 100}%` }}
                        title="Scene change"
                      />
                    ))}
                </div>

                {/* 3 Tracks */}
                {TRACKS.map((track, trackIndex) => {
                  const TrackIcon = track.icon;
                  return (
                    <div
                      className="track-row"
                      key={track.name}
                      style={{ top: 80 + trackIndex * 64 }}
                    >
                      <div className="track-label">
                        <TrackIcon size={14} />
                        <div>
                          <strong>{track.name}</strong>
                          <span>{track.type}</span>
                        </div>
                        <IconButton label={`Toggle ${track.name} visibility`}>
                          <Eye size={12} />
                        </IconButton>
                        <IconButton label={`Lock ${track.name}`}>
                          <Lock size={12} />
                        </IconButton>
                      </div>

                      <div
                        className="track-lane"
                        style={{ left: LABEL_WIDTH, width: timelineWidth }}
                      >
                        {(() => {
                          const trackSegments = segments.filter((s) => s.track === trackIndex);
                          const hasOverlap = trackSegments.some((s1, i) =>
                            trackSegments.some(
                              (s2, j) =>
                                i !== j &&
                                Math.max(s1.start, s2.start) < Math.min(s1.end, s2.end) - 0.1,
                            ),
                          );
                          return trackSegments.map((segment) => {
                            let subLane = 0;
                            if (hasOverlap) {
                              const priorOverlap = trackSegments.find(
                                (other) =>
                                  other.id !== segment.id &&
                                  Math.max(segment.start, other.start) <
                                    Math.min(segment.end, other.end) - 0.1 &&
                                  (other.id < segment.id ||
                                    (other.id === segment.id && other.start <= segment.start)),
                              );
                              if (priorOverlap) {
                                subLane = 1;
                              }
                            }
                            return (
                              <div
                                key={segment.id}
                                data-segment
                                className={cn(
                                  "segment-block",
                                  `source-${segment.source.toLowerCase()}`,
                                  selectedId === segment.id && "selected",
                                  playhead >= segment.start &&
                                    playhead <= segment.end &&
                                    "active-at-playhead",
                                  hasOverlap && "is-sublane",
                                )}
                                style={{
                                  left: `${(segment.start / duration) * 100}%`,
                                  width: `${((segment.end - segment.start) / duration) * 100}%`,
                                  ...(hasOverlap
                                    ? {
                                        top: subLane === 0 ? "5px" : "33px",
                                        height: "26px",
                                      }
                                    : {}),
                                }}
                                onPointerDown={(e) => beginTimelineDrag(e, segment, "move")}
                              >
                                <button
                                  className="trim-handle left"
                                  aria-label="Trim start"
                                  onPointerDown={(e) => beginTimelineDrag(e, segment, "trim-start")}
                                />
                                <div
                                  className="segment-content"
                                  style={hasOverlap ? { padding: "2px 14px 2px 6px" } : undefined}
                                >
                                  <span className="segment-source">
                                    {segment.source === "WHISPER" ? (
                                      <Mic2 size={10} />
                                    ) : (
                                      <Eye size={10} />
                                    )}
                                  </span>
                                  <p
                                    style={
                                      hasOverlap
                                        ? { fontSize: "8px", margin: "1px 0 0" }
                                        : undefined
                                    }
                                  >
                                    {segment.translated || segment.original}
                                  </p>
                                  <small
                                    style={hasOverlap ? { top: "2px", fontSize: "7px" } : undefined}
                                  >
                                    {(segment.end - segment.start).toFixed(1)}s
                                  </small>
                                </div>
                                <button
                                  className="trim-handle right"
                                  aria-label="Trim end"
                                  onPointerDown={(e) => beginTimelineDrag(e, segment, "trim-end")}
                                />
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  );
                })}

                {/* Cyan Inverted Triangle Playhead */}
                <div
                  className="playhead"
                  style={{ left: LABEL_WIDTH + (playhead / duration) * timelineWidth }}
                >
                  <span>{formatTime(playhead, true)}</span>
                  <i />
                </div>
              </div>
            </div>
          )}

          {!timelineOpen && (
            <button className="timeline-peek" onClick={() => setTimelineOpen(true)}>
              Show timeline <ChevronDown className="rotate-180" size={13} />
            </button>
          )}
        </section>
      </section>

      {/* RENDER FINISHED NOTIFICATION / MODAL */}
      {renderResult && (
        <div className="status-toast border-primary">
          <Sparkle size={14} className="text-primary" />
          <div className="flex items-center gap-3">
            <span>
              Video rendered: <strong>{renderResult.filename}</strong>
            </span>
            <a
              href={renderResult.video_url}
              download
              className="bg-primary text-primary-foreground text-xs px-2.5 py-1 rounded font-medium hover:opacity-90"
            >
              Download MP4
            </a>
            <button
              onClick={() => setRenderResult(null)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* BURN & EXPORT OPTIONS MODAL */}
      {showBurnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-panel border border-border rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-5 text-foreground">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-editor-teal/15 text-editor-teal flex items-center justify-center">
                  <Sparkle size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-base">Burn & Export Video</h3>
                  <p className="text-xs text-muted-foreground">
                    Select target format and auto-reframe settings
                  </p>
                </div>
              </div>
              <IconButton label="Close" onClick={() => setShowBurnModal(false)}>
                <X size={16} />
              </IconButton>
            </div>

            {/* 1. SELECT TARGET PLATFORM */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <span>1. Target Platform & Aspect Ratio</span>
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  className={cn(
                    "p-3 rounded-lg border-2 text-left transition-all flex flex-col gap-1.5 relative cursor-pointer",
                    reframeTarget === "tiktok"
                      ? "border-editor-teal bg-editor-teal/10 shadow-sm"
                      : "border-border hover:border-muted-foreground/50 hover:bg-secondary/50",
                  )}
                  onClick={() => {
                    setReframeTarget("tiktok");
                    setShowSafeZones(true);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <Smartphone
                      size={18}
                      className={
                        reframeTarget === "tiktok" ? "text-editor-teal" : "text-muted-foreground"
                      }
                    />
                    {reframeTarget === "tiktok" && (
                      <span className="w-2 h-2 rounded-full bg-editor-teal" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-xs">TikTok / Shorts</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      9:16 · 1080×1920
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className={cn(
                    "p-3 rounded-lg border-2 text-left transition-all flex flex-col gap-1.5 relative cursor-pointer",
                    reframeTarget === "youtube"
                      ? "border-editor-teal bg-editor-teal/10 shadow-sm"
                      : "border-border hover:border-muted-foreground/50 hover:bg-secondary/50",
                  )}
                  onClick={() => setReframeTarget("youtube")}
                >
                  <div className="flex items-center justify-between">
                    <Monitor
                      size={18}
                      className={
                        reframeTarget === "youtube" ? "text-editor-teal" : "text-muted-foreground"
                      }
                    />
                    {reframeTarget === "youtube" && (
                      <span className="w-2 h-2 rounded-full bg-editor-teal" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-xs">YouTube</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      16:9 · 1920×1080
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className={cn(
                    "p-3 rounded-lg border-2 text-left transition-all flex flex-col gap-1.5 relative cursor-pointer",
                    reframeTarget === "original"
                      ? "border-editor-teal bg-editor-teal/10 shadow-sm"
                      : "border-border hover:border-muted-foreground/50 hover:bg-secondary/50",
                  )}
                  onClick={() => setReframeTarget("original")}
                >
                  <div className="flex items-center justify-between">
                    <Film
                      size={18}
                      className={
                        reframeTarget === "original" ? "text-editor-teal" : "text-muted-foreground"
                      }
                    />
                    {reframeTarget === "original" && (
                      <span className="w-2 h-2 rounded-full bg-editor-teal" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-xs">Original</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {videoResolution ? videoResolution.split("·")[0].trim() : "Native AR"}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* 2. FRAMING MODE (when reframed) */}
            {reframeTarget !== "original" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  2. Framing Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className={cn(
                      "p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                      reframeMode === "blur"
                        ? "border-editor-teal bg-editor-teal/10 font-semibold"
                        : "border-border hover:bg-secondary/50 text-muted-foreground",
                    )}
                    onClick={() => setReframeMode("blur")}
                  >
                    <div className="text-xs text-foreground font-medium">Blur Background</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Smart blurred fill (No video content cut off)
                    </div>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                      reframeMode === "crop"
                        ? "border-editor-teal bg-editor-teal/10 font-semibold"
                        : "border-border hover:bg-secondary/50 text-muted-foreground",
                    )}
                    onClick={() => setReframeMode("crop")}
                  >
                    <div className="text-xs text-foreground font-medium">Crop to Fill</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Fills full frame (Crops edges)
                    </div>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                      reframeMode === "fit"
                        ? "border-editor-teal bg-editor-teal/10 font-semibold"
                        : "border-border hover:bg-secondary/50 text-muted-foreground",
                    )}
                    onClick={() => setReframeMode("fit")}
                  >
                    <div className="text-xs text-foreground font-medium">Black Bars</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Classic letterbox/pillarbox padding
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* 3. TIKTOK CAPTION POSITION ADAPTATION */}
            {reframeTarget === "tiktok" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  3. Subtitle Positioning for TikTok
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className="p-2 rounded-lg border border-border hover:border-editor-teal hover:bg-secondary/50 text-left transition-all cursor-pointer"
                    onClick={() => {
                      setSegments((prev) => prev.map((s) => (s.y >= 65 ? { ...s, y: 76 } : s)));
                      quickAction("Subtitles placed at TikTok Safe Lower Third (76%)");
                    }}
                  >
                    <div className="text-xs font-medium">TikTok Safe (76%)</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Above description & sound
                    </div>
                  </button>
                  <button
                    type="button"
                    className="p-2 rounded-lg border border-border hover:border-editor-teal hover:bg-secondary/50 text-left transition-all cursor-pointer"
                    onClick={() => {
                      setSegments((prev) => prev.map((s) => (s.y >= 65 ? { ...s, y: 50 } : s)));
                      quickAction("Subtitles placed at Center Hook (50%)");
                    }}
                  >
                    <div className="text-xs font-medium">Center Hook (50%)</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Viral hook middle position
                    </div>
                  </button>
                  <button
                    type="button"
                    className="p-2 rounded-lg border border-border hover:border-editor-teal hover:bg-secondary/50 text-left transition-all cursor-pointer"
                    onClick={() => {
                      setSegments((prev) => prev.map((s) => (s.y >= 65 ? { ...s, y: 62 } : s)));
                      quickAction("Subtitles aligned over centered original video (62%)");
                    }}
                  >
                    <div className="text-xs font-medium">Mask Original (62%)</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Covers original video text
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* FLIP / MIRROR VIDEO */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center justify-between">
                <span>Video Mirror / Flip (Horizontal)</span>
                <span className="text-[10px] text-editor-teal font-normal">
                  keeps transcript OCR intact
                </span>
              </label>
              <button
                type="button"
                className={cn(
                  "w-full p-2.5 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer",
                  flipHorizontal
                    ? "border-editor-teal bg-editor-teal/10 text-foreground"
                    : "border-border hover:bg-secondary/50 text-muted-foreground hover:text-foreground",
                )}
                onClick={toggleFlipHorizontal}
              >
                <div className="flex items-center gap-2.5">
                  <FlipHorizontal
                    size={18}
                    className={flipHorizontal ? "text-editor-teal" : "text-muted-foreground"}
                  />
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      {flipHorizontal
                        ? "Horizontal Flip (Mirror) Enabled"
                        : "Horizontal Flip (Mirror) Disabled"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {flipHorizontal
                        ? "Video is burned horizontally mirrored. Subtitles are positioned over mirrored video."
                        : "Standard original video orientation without horizontal mirroring."}
                    </div>
                  </div>
                </div>
                <div
                  className={cn(
                    "w-8 h-4 rounded-full transition-colors relative flex items-center p-0.5 shrink-0",
                    flipHorizontal ? "bg-editor-teal" : "bg-muted-foreground/30",
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full bg-white transition-transform",
                      flipHorizontal ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </div>
              </button>
            </div>

            {/* SUMMARY INFO BOX */}
            <div className="bg-secondary/60 border border-border rounded-lg p-3 text-xs flex items-center justify-between">
              <div>
                <span className="text-muted-foreground">Output: </span>
                <strong className="text-foreground">
                  {reframeTarget === "tiktok"
                    ? "1080 × 1920 (9:16 Vertical)"
                    : reframeTarget === "youtube"
                      ? "1920 × 1080 (16:9 Landscape)"
                      : "Original Resolution"}
                </strong>
                <span className="text-muted-foreground">
                  {" "}
                  · {segments.length} subtitles · {maskMode}
                  {flipHorizontal && " · Mirrored"}
                </span>
              </div>
              <span className="font-mono text-editor-teal font-semibold text-[11px]">
                H.264 / AAC
              </span>
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setShowBurnModal(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowBurnModal(false);
                  burnAndExportVideo();
                }}
                disabled={isRendering}
                className="gap-1.5 cursor-pointer"
              >
                <Sparkle size={14} />
                {isRendering
                  ? "Rendering..."
                  : `Start Burn & Export (${reframeTarget === "tiktok" ? "TikTok 9:16" : reframeTarget === "youtube" ? "YouTube 16:9" : "Original"})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* EXTENSION SETUP MODAL */}
      {showExtensionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-panel border border-border rounded-lg shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Sparkle size={16} className="text-editor-teal" />
                <h3 className="font-semibold text-sm text-foreground">Chrome AI Extension Setup</h3>
              </div>
              <IconButton label="Close" onClick={() => setShowExtensionModal(false)}>
                <X size={14} />
              </IconButton>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Modern browsers prevent websites from directly typing or clicking buttons inside other
              websites (Same-Origin Policy). The included extension acts as a secure local bridge
              between Video Subtitle Studio and <strong>ChatGPT</strong>, <strong>Claude</strong>,
              or <strong>DeepSeek</strong>.
            </p>
            <div className="p-3 bg-secondary/80 border border-border rounded-md text-xs space-y-2 font-mono">
              <div className="text-foreground font-semibold">10-Second Setup:</div>
              <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                <li>
                  Open <span className="text-editor-teal select-all">chrome://extensions</span> in
                  Chrome or Edge
                </li>
                <li>
                  Toggle ON <strong>Developer mode</strong> (top-right switch)
                </li>
                <li>
                  Click <strong>Load unpacked</strong> (top-left button)
                </li>
                <li>
                  Select the folder: <br />
                  <span className="text-foreground bg-background px-1.5 py-0.5 rounded select-all break-all border border-border inline-block mt-1">
                    video-subtitle-overlay/subtitle-ai-extension
                  </span>{" "}
                  (in your project directory)
                </li>
              </ol>
            </div>
            <div className="text-[11px] text-muted-foreground bg-background/50 p-2.5 rounded border border-border/50">
              💡 <strong>No extension installed?</strong> No problem! Clicking ChatGPT or Claude
              automatically copies the structured prompt to your clipboard and opens the tab. Just
              press{" "}
              <kbd className="px-1 py-0.5 bg-secondary rounded border border-border text-foreground font-mono text-[10px]">
                Ctrl + V
              </kbd>{" "}
              and{" "}
              <kbd className="px-1 py-0.5 bg-secondary rounded border border-border text-foreground font-mono text-[10px]">
                Enter
              </kbd>
              !
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => setShowExtensionModal(false)}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS TOAST */}
      {status && (
        <div className="status-toast">
          <Circle size={8} fill="currentColor" />
          {status}
        </div>
      )}
    </main>
  );
}
