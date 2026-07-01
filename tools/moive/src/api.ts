import type { Category, Episode, PlaySource, VideoDetail, VideoPage, VideoSummary } from './types';

const DEFAULT_REMOTE_BASE = 'https://cj.rycjapi.com/api.php/provide/vod/';
const DEV_PROXY_BASE = '/cms-api/api.php/provide/vod/';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_RETRIES = 3;

type CmsParams = Record<string, string | number | undefined>;
type CmsRecord = Record<string, unknown>;

interface CmsResponse extends CmsRecord {
  class?: CmsRecord[];
  classes?: CmsRecord[];
  list?: CmsRecord[];
}

interface CmsRequestError extends Error {
  status?: number;
  retryable?: boolean;
}

let categoryCache: {
  expiresAt: number;
  categories: Category[];
} = {
  expiresAt: 0,
  categories: [],
};

export function getCmsBase(): string {
  if (import.meta.env.VITE_CMS_API_BASE) {
    return normalizeCmsBase(import.meta.env.VITE_CMS_API_BASE);
  }

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return DEV_PROXY_BASE;
  }

  return DEFAULT_REMOTE_BASE;
}

export async function fetchCategories(): Promise<Category[]> {
  return getCategories();
}

export async function fetchVideos({ type = '', page = 1 }: { type?: string; page?: number }): Promise<VideoPage> {
  const normalizedPage = clampPage(page);

  if (type) {
    const categories = await getCategories();
    const childIds = categories.filter((item) => item.pid === type).map((item) => item.id);

    if (childIds.length > 0) {
      const results = await Promise.allSettled(
        childIds.map((childId) => requestCms({ ac: 'videolist', t: childId, pg: normalizedPage }))
      );
      const pages = results
        .filter((result): result is PromiseFulfilledResult<CmsResponse> => result.status === 'fulfilled')
        .map((result) => result.value);

      if (pages.length === 0) {
        const firstError = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
        throw firstError?.reason || new Error('父分类下的子分类请求全部失败');
      }

      return normalizeAggregatedVideoPage(pages, normalizedPage);
    }
  }

  const data = await requestCms({
    ac: 'videolist',
    t: type,
    pg: normalizedPage,
  });

  return normalizeVideoPage(data);
}

export async function searchVideos({ keyword, page = 1 }: { keyword: string; page?: number }): Promise<VideoPage> {
  const wd = keyword.trim();

  if (!wd) {
    return emptyVideoPage();
  }

  const data = await requestCms({
    ac: 'videolist',
    wd,
    pg: clampPage(page),
  });

  return normalizeVideoPage(data);
}

export async function fetchVideoDetail(id: string): Promise<VideoDetail> {
  const value = id.trim();

  if (!/^\d+$/.test(value)) {
    throw new Error('视频 ID 无效');
  }

  const data = await requestCms({ ac: 'detail', ids: value });
  const item = Array.isArray(data.list) ? data.list[0] : null;

  if (!item) {
    throw new Error('没有找到视频详情');
  }

  return normalizeVideoDetail(item);
}

async function getCategories(): Promise<Category[]> {
  if (categoryCache.expiresAt > Date.now()) {
    return categoryCache.categories;
  }

  const data = await requestCms({ ac: 'list' });
  const categories = normalizeCategories(data.class || data.classes || []);

  categoryCache = {
    expiresAt: Date.now() + CACHE_TTL,
    categories,
  };

  return categories;
}

async function requestCms(params: CmsParams): Promise<CmsResponse> {
  const url = createCmsUrl(params);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await requestCmsOnce(url);
    } catch (error) {
      lastError = error;

      if (!shouldRetryCmsError(error) || attempt === MAX_RETRIES) {
        break;
      }

      await delay(350 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('资源站接口请求失败');
}

async function requestCmsOnce(url: string): Promise<CmsResponse> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json,text/plain,*/*',
      },
    });
  } catch {
    const requestError = new Error(
      '无法访问资源站接口。若是线上静态部署，通常是资源站没有开放 CORS，需要同域部署或配置边缘代理。'
    ) as CmsRequestError;
    requestError.retryable = true;
    throw requestError;
  }

  if (!response.ok) {
    const statusError = new Error(`资源站接口请求失败：${response.status}`) as CmsRequestError;
    statusError.status = response.status;
    statusError.retryable = response.status === 502 || response.status === 503 || response.status === 504;
    throw statusError;
  }

  const responseText = await response.text();

  try {
    return JSON.parse(responseText) as CmsResponse;
  } catch {
    throw new Error('资源站没有返回 JSON，请确认使用的是 JSON 接口。');
  }
}

function shouldRetryCmsError(error: unknown): boolean {
  return Boolean((error as CmsRequestError | undefined)?.retryable);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createCmsUrl(params: CmsParams): string {
  const base = getCmsBase();
  const url = base.startsWith('http') ? new URL(base) : new URL(base, location.origin);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function normalizeCmsBase(rawBase: string): string {
  const url = rawBase.startsWith('http') ? new URL(rawBase) : new URL(rawBase, location.origin);

  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }

  return url.toString();
}

function normalizeCategories(categories: CmsRecord[]): Category[] {
  return categories
    .map((item) => ({
      id: stringValue(item.type_id ?? item.id).trim(),
      pid: stringValue(item.type_pid ?? item.pid ?? '0').trim(),
      name: stringValue(item.type_name ?? item.name).trim(),
    }))
    .filter((item) => item.id && item.name);
}

function normalizeVideoPage(data: CmsResponse): VideoPage {
  return {
    page: numberValue(data.page, 1),
    pageCount: numberValue(data.pagecount ?? data.page_count, 1),
    total: numberValue(data.total, 0),
    videos: Array.isArray(data.list) ? data.list.map(normalizeVideoSummary) : [],
  };
}

function normalizeAggregatedVideoPage(pages: CmsResponse[], page: number): VideoPage {
  const videosById = new Map<string, VideoSummary>();

  for (const data of pages) {
    for (const item of Array.isArray(data.list) ? data.list : []) {
      const summary = normalizeVideoSummary(item);

      if (summary.id && !videosById.has(summary.id)) {
        videosById.set(summary.id, summary);
      }
    }
  }

  const videos = [...videosById.values()]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 20);

  return {
    page,
    pageCount: Math.max(...pages.map((data) => numberValue(data.pagecount ?? data.page_count, 1)), 1),
    total: pages.reduce((sum, data) => sum + numberValue(data.total, 0), 0),
    videos,
  };
}

function emptyVideoPage(): VideoPage {
  return {
    page: 1,
    pageCount: 1,
    total: 0,
    videos: [],
  };
}

function normalizeVideoSummary(item: CmsRecord): VideoSummary {
  return {
    id: stringValue(item.vod_id ?? item.id),
    name: stringValue(item.vod_name ?? item.name) || '未命名影片',
    alias: stringValue(item.vod_sub),
    slug: stringValue(item.vod_en),
    pic: stringValue(item.vod_pic),
    remark: stringValue(item.vod_remarks ?? item.vod_serial),
    year: stringValue(item.vod_year),
    area: stringValue(item.vod_area),
    lang: stringValue(item.vod_lang),
    type: stringValue(item.type_name),
    time: stringValue(item.vod_time),
  };
}

function normalizeVideoDetail(item: CmsRecord): VideoDetail {
  return {
    ...normalizeVideoSummary(item),
    actor: stringValue(item.vod_actor),
    director: stringValue(item.vod_director),
    content: stripHtml(stringValue(item.vod_content ?? item.vod_blurb)),
    sources: parsePlaySources(stringValue(item.vod_play_from), stringValue(item.vod_play_url)),
  };
}

function parsePlaySources(playFrom: string, playUrl: string): PlaySource[] {
  const sourceNames = playFrom
    .split(/\$\$\$|,/)
    .map((name) => name.trim())
    .filter(Boolean);

  return playUrl
    .split('$$$')
    .map((group, index) => ({
      name: sourceNames[index] || `播放源 ${index + 1}`,
      episodes: parseEpisodes(group),
    }))
    .filter((source) => source.episodes.length > 0);
}

function parseEpisodes(group: string): Episode[] {
  return group
    .split('#')
    .map((episode, index) => {
      const separatorIndex = episode.indexOf('$');
      const rawName = separatorIndex >= 0 ? episode.slice(0, separatorIndex) : `第 ${index + 1} 集`;
      const rawUrl = separatorIndex >= 0 ? episode.slice(separatorIndex + 1) : episode;
      const url = normalizeHttpUrl(rawUrl);

      if (!url) {
        return null;
      }

      return {
        name: rawName.trim() || `第 ${index + 1} 集`,
        url,
        isHls: /\.m3u8(?:\?|$)/i.test(url),
      };
    })
    .filter((episode): episode is Episode => Boolean(episode));
}

function normalizeHttpUrl(rawUrl: string): string {
  const value = rawUrl.trim();

  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .trim();
}

export function clampPage(value: string | number | null | undefined): number {
  const page = Number(value || 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}
