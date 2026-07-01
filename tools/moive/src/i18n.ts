import type { ContentLanguage, UiLanguage, VideoSummary } from './types';

type UiTextMap = Record<UiLanguage, Record<string, string>>;

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}

interface TranslatorFactory {
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}

interface TranslatorGlobal {
  Translator?: TranslatorFactory;
  ai?: {
    translator?: TranslatorFactory;
  };
}

const translationCache = new Map<string, string>();

export const uiText: UiTextMap = {
  zh: {
    appTitle: '清风影院',
    navMovies: '影片',
    navSearch: '搜索',
    navWatch: '播放',
    searchPlaceholder: '搜索影片、剧集、综艺',
    search: '搜索',
    all: '全部',
    allPrefix: '全部',
    loadingCategories: '正在加载分类...',
    loadingVideos: '正在加载视频...',
    categoryList: '影片列表',
    searchResult: '搜索结果',
    searching: '搜索',
    selectVideo: '请选择视频',
    selectHint: '从列表或搜索结果进入播放页。',
    noResult: '暂无结果',
    prev: '上一页',
    next: '下一页',
    page: '第 {page} / {pageCount} 页',
    subtitleOff: '字幕关闭',
    subtitleUrl: 'VTT 字幕 URL',
    loadSubtitle: '加载字幕',
    localSubtitle: '本地字幕',
    externalSubtitle: '外部字幕',
    embeddedSubtitle: '内置字幕',
    source: '播放源',
    episodes: '剧集',
    noEpisodes: '暂无可播放剧集',
    director: '导演',
    actor: '主演',
    alias: '又名',
    noSummary: '暂无简介',
    noInfo: '暂无详情',
    noUpdate: '暂无更新信息',
    uncategorized: '未分类',
    nowPlaying: '正在播放',
    hlsUnsupported: '当前浏览器不支持 HLS 播放。',
    uiLanguage: '界面',
    contentLanguage: '内容',
    original: '原文',
    chinese: '中文',
    english: 'English',
    api: '接口',
    translationFallback: '当前环境没有可用翻译能力，已显示原文。',
    moviesTitle: '发现影片',
    moviesSubtitle: '按分类浏览资源站内容，点击卡片进入播放页。',
    searchTitle: '搜索影片',
    searchSubtitle: '输入片名、演员或关键词，结果会独立展示在当前页面。',
    watchBack: '返回列表',
  },
  en: {
    appTitle: 'Fresh Cinema',
    navMovies: 'Movies',
    navSearch: 'Search',
    navWatch: 'Watch',
    searchPlaceholder: 'Search movies, series, shows',
    search: 'Search',
    all: 'All',
    allPrefix: 'All ',
    loadingCategories: 'Loading categories...',
    loadingVideos: 'Loading videos...',
    categoryList: 'Movie list',
    searchResult: 'Search results',
    searching: 'Search',
    selectVideo: 'Select a video',
    selectHint: 'Open a video from the list or search results.',
    noResult: 'No results',
    prev: 'Prev',
    next: 'Next',
    page: 'Page {page} / {pageCount}',
    subtitleOff: 'Subtitles off',
    subtitleUrl: 'VTT subtitle URL',
    loadSubtitle: 'Load',
    localSubtitle: 'Local VTT',
    externalSubtitle: 'External subtitle',
    embeddedSubtitle: 'Embedded subtitle',
    source: 'Source',
    episodes: 'Episodes',
    noEpisodes: 'No playable episodes',
    director: 'Director',
    actor: 'Cast',
    alias: 'Also known as',
    noSummary: 'No summary',
    noInfo: 'No details',
    noUpdate: 'No update info',
    uncategorized: 'Uncategorized',
    nowPlaying: 'Now playing',
    hlsUnsupported: 'This browser does not support HLS playback.',
    uiLanguage: 'UI',
    contentLanguage: 'Content',
    original: 'Original',
    chinese: '中文',
    english: 'English',
    api: 'API',
    translationFallback: 'No translation provider is available; original text is shown.',
    moviesTitle: 'Discover',
    moviesSubtitle: 'Browse source content by category, then open a card to watch.',
    searchTitle: 'Search',
    searchSubtitle: 'Search by title, cast, or keyword. Results stay on their own route.',
    watchBack: 'Back',
  },
};

export function t(uiLanguage: UiLanguage, key: string, params: Record<string, string | number> = {}): string {
  const template = uiText[uiLanguage]?.[key] || uiText.zh[key] || key;

  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    template
  );
}

export function getDisplayTitle(video: VideoSummary | null | undefined, contentLanguage: ContentLanguage): string {
  if (!video) {
    return '';
  }

  if (contentLanguage === 'en') {
    const alias = getLatinAlias(video.alias);

    if (alias) {
      return alias;
    }
  }

  return video.name;
}

export function getMetaParts(video: VideoSummary, contentLanguage: ContentLanguage): string[] {
  return [video.remark, video.year, video.area, video.lang, localizeType(video.type, contentLanguage)].filter(Boolean);
}

export function localizeCategoryName(name: string, contentLanguage: ContentLanguage): string {
  if (contentLanguage !== 'en') {
    return name;
  }

  return categoryNameMap[name] || name;
}

export function localizeType(name: string, contentLanguage: ContentLanguage): string {
  return localizeCategoryName(name, contentLanguage);
}

export async function translateText(text: string, targetLanguage: ContentLanguage): Promise<string> {
  const value = text.trim();

  if (!value || targetLanguage === 'original' || targetLanguage === 'zh') {
    return value;
  }

  if (targetLanguage === 'en' && isMostlyEnglish(value)) {
    return value;
  }

  const cacheKey = `${targetLanguage}:${value}`;

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey) || value;
  }

  const translated = await tryBrowserTranslator(value, targetLanguage) || await tryConfiguredTranslator(value, targetLanguage) || value;

  translationCache.set(cacheKey, translated);
  return translated;
}

function getLatinAlias(alias: string): string {
  const values = alias
    .split(/\s*\/\s*|\s*，\s*|\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.find((item) => /[a-z]/i.test(item) && !/[\u4e00-\u9fff]/.test(item)) || '';
}

function isMostlyEnglish(text: string): boolean {
  const letters = text.match(/[a-z]/gi)?.length || 0;
  const chinese = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  return letters > 0 && chinese === 0;
}

async function tryBrowserTranslator(text: string, targetLanguage: ContentLanguage): Promise<string> {
  const browserGlobal = globalThis as typeof globalThis & TranslatorGlobal;

  try {
    if (browserGlobal.Translator?.create) {
      const translator = await browserGlobal.Translator.create({
        sourceLanguage: 'zh',
        targetLanguage,
      });
      return await translator.translate(text);
    }

    if (browserGlobal.ai?.translator?.create) {
      const translator = await browserGlobal.ai.translator.create({
        sourceLanguage: 'zh',
        targetLanguage,
      });
      return await translator.translate(text);
    }
  } catch {
    return '';
  }

  return '';
}

async function tryConfiguredTranslator(text: string, targetLanguage: ContentLanguage): Promise<string> {
  const endpoint = import.meta.env.VITE_TRANSLATE_ENDPOINT;

  if (!endpoint) {
    return '';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source: 'auto',
        target: targetLanguage,
        format: 'text',
      }),
    });

    if (!response.ok) {
      return '';
    }

    const data = await response.json() as Record<string, unknown>;
    return typeof data.translatedText === 'string'
      ? data.translatedText
      : typeof data.translation === 'string'
        ? data.translation
        : '';
  } catch {
    return '';
  }
}

const categoryNameMap: Record<string, string> = {
  电影片: 'Movies',
  连续剧: 'Series',
  综艺片: 'Variety',
  动漫片: 'Anime',
  动作片: 'Action',
  喜剧片: 'Comedy',
  爱情片: 'Romance',
  科幻片: 'Sci-Fi',
  恐怖片: 'Horror',
  剧情片: 'Drama',
  战争片: 'War',
  国产剧: 'Chinese Drama',
  香港剧: 'Hong Kong Drama',
  韩国剧: 'Korean Drama',
  欧美剧: 'Western Series',
  记录片: 'Documentary',
  台湾剧: 'Taiwan Drama',
  日本剧: 'Japanese Drama',
  海外剧: 'Overseas Drama',
  泰国剧: 'Thai Drama',
  大陆综艺: 'Mainland Variety',
  港台综艺: 'HK/TW Variety',
  日韩综艺: 'JP/KR Variety',
  欧美综艺: 'Western Variety',
  国产动漫: 'Chinese Anime',
  日韩动漫: 'JP/KR Anime',
  欧美动漫: 'Western Anime',
  港台动漫: 'HK/TW Anime',
  海外动漫: 'Overseas Anime',
  伦理片: 'Ethics',
  电影解说: 'Movie Commentary',
  体育: 'Sports',
  足球: 'Football',
  篮球: 'Basketball',
  网球: 'Tennis',
  斯诺克: 'Snooker',
  预告片: 'Trailers',
  短剧: 'Short Drama',
  动画电影: 'Animated Movies',
};
