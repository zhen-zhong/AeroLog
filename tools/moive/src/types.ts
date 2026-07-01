import type React from 'react';

export type UiLanguage = 'zh' | 'en';
export type ContentLanguage = 'original' | 'zh' | 'en';

export interface Category {
  id: string;
  pid: string;
  name: string;
}

export interface VideoSummary {
  id: string;
  name: string;
  alias: string;
  slug: string;
  pic: string;
  remark: string;
  year: string;
  area: string;
  lang: string;
  type: string;
  time: string;
}

export interface Episode {
  name: string;
  url: string;
  isHls: boolean;
}

export interface PlaySource {
  name: string;
  episodes: Episode[];
}

export interface VideoDetail extends VideoSummary {
  actor: string;
  director: string;
  content: string;
  sources: PlaySource[];
}

export interface VideoPage {
  page: number;
  pageCount: number;
  total: number;
  videos: VideoSummary[];
}

export type TextFn = (key: string, params?: Record<string, string | number>) => string;

export interface SubtitleTrackOption {
  id: string;
  label: string;
  hlsIndex?: number;
  nativeTrack?: TextTrack;
  manualTrack?: HTMLTrackElement;
}

export interface LanguageControlsProps {
  contentLanguage: ContentLanguage;
  setContentLanguage: React.Dispatch<React.SetStateAction<ContentLanguage>>;
  setUiLanguage: React.Dispatch<React.SetStateAction<UiLanguage>>;
  text: TextFn;
  uiLanguage: UiLanguage;
}
