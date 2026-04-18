export type PageSnapshot = {
  url: string;
  title: string;
  text: string;
  textTruncated: boolean;
  /** JPEG base64 of the visible tab viewport (for Gemini VLM). */
  viewportScreenshotJpeg?: string | null;
  /** How the page was prepared before text extraction. */
  captureMeta?: {
    scrollExpanded: boolean;
    scrollUsedMs: number;
    maxTextChars: number;
  };
  images: Array<{
    alt: string;
    src: string;
    base64Jpeg: string | null;
  }>;
  media: Array<{
    tag: "video" | "audio" | "iframe";
    src: string;
    title: string;
    description: string;
  }>;
  capturedAt: number;
};

export type ChatMessage = {
  role: "user" | "model";
  text: string;
};

/** Sent from background → content script with PAGE_TUTOR_CAPTURE. */
export type ContentCaptureOptions = {
  scrollBeforeCapture: boolean;
  scrollMaxMs: number;
  /** Stop after scrolling roughly this many viewport heights (limits infinite feeds). */
  scrollMaxViewportHeights: number;
  maxTextChars: number;
  maxInlineImages: number;
};
