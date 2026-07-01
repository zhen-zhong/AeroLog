import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Check, ChevronDown, Languages, Search, X } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAppSettings } from './App';
import { getDisplayTitle, getMetaParts, localizeCategoryName } from './i18n';
import type {
  Category,
  ContentLanguage,
  LanguageControlsProps,
  SubtitleTrackOption,
  TextFn,
  UiLanguage,
  VideoSummary,
} from './types';

export interface WatchLinkContext {
  from: 'movies' | 'search';
  keyword?: string;
  page: number;
  type?: string;
}

export function AppFrame({
  children,
  eyebrow,
  headerTitle = '',
  hideBrandText = false,
  headingBefore,
  showHeading = true,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  headerTitle?: string;
  hideBrandText?: boolean;
  headingBefore?: React.ReactNode;
  showHeading?: boolean;
  subtitle: string;
  title: string;
}) {
  const { contentLanguage, setContentLanguage, setUiLanguage, text, uiLanguage } = useAppSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [languageModalOpen, setLanguageModalOpen] = useState(false);
  const [headerOpacity, setHeaderOpacity] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearchInput(location.pathname === '/search' ? params.get('wd') || '' : '');
  }, [location.pathname, location.search]);

  useEffect(() => {
    let frame = 0;

    function updateHeaderOpacity() {
      frame = 0;
      const nextOpacity = Math.max(0, Math.min(1, 1 - window.scrollY / 100));
      setHeaderOpacity(nextOpacity);
    }

    function handleScroll() {
      if (!frame) {
        frame = window.requestAnimationFrame(updateHeaderOpacity);
      }
    }

    updateHeaderOpacity();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = searchInput.trim();

    if (!keyword) {
      navigate('/search');
      return;
    }

    navigate(`/search?wd=${encodeURIComponent(keyword)}`);
  }

  return (
    <div className="app-shell">
      <header
        className={`topbar ${headerTitle ? 'has-header-title' : ''} ${headerOpacity <= 0.02 ? 'is-hidden' : ''}`}
        style={{ '--header-opacity': headerOpacity } as CSSProperties}
      >
        <Link className="brand-mark" to="/">
          <span className="brand-logo">CF</span>
          {!hideBrandText && (
            <span>
              <strong>{text('appTitle')}</strong>
            </span>
          )}
        </Link>

        {headerTitle && <strong className="header-title" title={headerTitle}>{headerTitle}</strong>}

        <nav className="main-nav" aria-label="Primary">
          <NavLink to="/">{text('navMovies')}</NavLink>
          <NavLink to="/search">{text('navSearch')}</NavLink>
        </nav>

        <form className="top-search" onSubmit={submitSearch}>
          <input
            autoComplete="off"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={text('searchPlaceholder')}
            type="search"
            value={searchInput}
          />
          <button className="primary" type="submit">{text('search')}</button>
        </form>

        <LanguageControls
          contentLanguage={contentLanguage}
          setContentLanguage={setContentLanguage}
          setUiLanguage={setUiLanguage}
          text={text}
          uiLanguage={uiLanguage}
        />

        <div className="mobile-actions">
          <button
            aria-label={text('contentLanguage')}
            className="icon-btn"
            onClick={() => setLanguageModalOpen(true)}
            title={text('contentLanguage')}
            type="button"
          >
            <Languages aria-hidden="true" size={20} strokeWidth={2.4} />
          </button>
          <Link aria-label={text('navSearch')} className="icon-btn" title={text('navSearch')} to="/search">
            <Search aria-hidden="true" size={20} strokeWidth={2.4} />
          </Link>
        </div>
      </header>

      {languageModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLanguageModalOpen(false)}>
          <section
            aria-modal="true"
            className="language-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <strong>{text('contentLanguage')}</strong>
              <button
                aria-label="Close"
                className="icon-btn"
                onClick={() => setLanguageModalOpen(false)}
                title="Close"
                type="button"
              >
                <X aria-hidden="true" size={20} strokeWidth={2.4} />
              </button>
            </header>
            <LanguageModalChoices
              contentLanguage={contentLanguage}
              setContentLanguage={setContentLanguage}
              setUiLanguage={setUiLanguage}
              text={text}
              uiLanguage={uiLanguage}
            />
          </section>
        </div>
      )}

      <main className="page">
        {headingBefore}
        {showHeading && (
          <section className="page-heading">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <span>{subtitle}</span>
          </section>
        )}
        {children}
      </main>
    </div>
  );
}

export function LanguageControls({ contentLanguage, setContentLanguage, setUiLanguage, text, uiLanguage }: LanguageControlsProps) {
  return (
    <div className="language-controls">
      <label>
        <span>{text('uiLanguage')}</span>
        <select onChange={(event) => setUiLanguage(event.target.value as 'zh' | 'en')} value={uiLanguage}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        <span>{text('contentLanguage')}</span>
        <select onChange={(event) => setContentLanguage(event.target.value as ContentLanguage)} value={contentLanguage}>
          <option value="original">{text('original')}</option>
          <option value="zh">{text('chinese')}</option>
          <option value="en">{text('english')}</option>
        </select>
      </label>
    </div>
  );
}

function LanguageModalChoices({ contentLanguage, setContentLanguage, setUiLanguage, text, uiLanguage }: LanguageControlsProps) {
  const uiOptions: Array<{ label: string; value: UiLanguage }> = [
    { label: '中文', value: 'zh' },
    { label: 'English', value: 'en' },
  ];
  const contentOptions: Array<{ label: string; value: ContentLanguage }> = [
    { label: text('original'), value: 'original' },
    { label: text('chinese'), value: 'zh' },
    { label: text('english'), value: 'en' },
  ];

  return (
    <div className="language-choice-panel">
      <section className="language-choice-group">
        <span>{text('uiLanguage')}</span>
        <div>
          {uiOptions.map((option) => (
            <button
              className={`language-choice ${uiLanguage === option.value ? 'active' : ''}`}
              key={option.value}
              onClick={() => setUiLanguage(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="language-choice-group">
        <span>{text('contentLanguage')}</span>
        <div>
          {contentOptions.map((option) => (
            <button
              className={`language-choice ${contentLanguage === option.value ? 'active' : ''}`}
              key={option.value}
              onClick={() => setContentLanguage(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CategoryRow({
  activeId,
  allActive,
  allLabel,
  categories,
  contentLanguage,
  linkFor,
}: {
  activeId: string;
  allActive: boolean;
  allLabel: string;
  categories: Category[];
  contentLanguage: ContentLanguage;
  linkFor: (id: string) => string;
}) {
  return (
    <nav className="categories">
      <Link className={`category ${allActive ? 'active' : ''}`} to={linkFor('')}>
        {allLabel}
      </Link>
      {categories.map((category) => (
        <Link
          className={`category ${activeId === category.id ? 'active' : ''}`}
          key={category.id}
          to={linkFor(category.id)}
        >
          {localizeCategoryName(category.name, contentLanguage)}
        </Link>
      ))}
    </nav>
  );
}

export function StatusLine({ error, loading, status }: { error: string; loading: boolean; status: string }) {
  return (
    <div className={`status ${error ? 'error' : ''}`}>
      {loading && <span className="spinner" />}
      {error || status}
    </div>
  );
}

export function VideoGrid({
  contentLanguage,
  emptyText,
  loading,
  text,
  videos,
  watchContext,
}: {
  contentLanguage: ContentLanguage;
  emptyText: string;
  loading: boolean;
  text: TextFn;
  videos: VideoSummary[];
  watchContext: WatchLinkContext;
}) {
  if (videos.length === 0 && !loading) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <section className="video-grid">
      {videos.map((video) => (
        <VideoCard
          contentLanguage={contentLanguage}
          key={video.id}
          text={text}
          to={createWatchPath(video.id, watchContext)}
          video={video}
        />
      ))}
    </section>
  );
}

export function VideoCard({
  contentLanguage,
  text,
  to,
  video,
}: {
  contentLanguage: ContentLanguage;
  text: TextFn;
  to: string;
  video: VideoSummary;
}) {
  const title = getDisplayTitle(video, contentLanguage);
  const meta = getMetaParts(video, contentLanguage);

  return (
    <Link className="video-card" to={to}>
      {video.pic ? (
        <img alt={title} className="poster" loading="lazy" referrerPolicy="no-referrer" src={video.pic} />
      ) : (
        <div className="poster poster-fallback">NO IMG</div>
      )}
      <span className="video-info">
        <span className="video-title">{title}</span>
        <span className="video-sub">{meta.slice(0, 4).join(' · ') || text('noUpdate')}</span>
        <span className="video-type">{meta[4] || text('uncategorized')}</span>
      </span>
    </Link>
  );
}

export function Pager({
  onPage,
  page,
  pageCount,
  text,
}: {
  onPage: (page: number) => void;
  page: number;
  pageCount: number;
  text: TextFn;
}) {
  return (
    <footer className="pager">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">
        {text('prev')}
      </button>
      <span>{text('page', { page, pageCount })}</span>
      <button disabled={page >= pageCount} onClick={() => onPage(page + 1)} type="button">
        {text('next')}
      </button>
    </footer>
  );
}

export function SubtitleControls({
  loadSubtitleFromFile,
  loadSubtitleFromUrl,
  setSubtitleUrl,
  subtitleSelection,
  subtitleTracks,
  subtitleUrl,
  text,
  onChooseSubtitle,
}: {
  loadSubtitleFromFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  loadSubtitleFromUrl: () => void;
  setSubtitleUrl: React.Dispatch<React.SetStateAction<string>>;
  subtitleSelection: string;
  subtitleTracks: SubtitleTrackOption[];
  subtitleUrl: string;
  text: TextFn;
  onChooseSubtitle: (value: string) => void;
}) {
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const subtitleSelectRef = useRef<HTMLDivElement | null>(null);
  const subtitleOptions = [
    { id: 'off', label: text('subtitleOff') },
    ...subtitleTracks.map((track) => ({ id: track.id, label: track.label })),
  ];
  const selectedSubtitleLabel = subtitleOptions.find((option) => option.id === subtitleSelection)?.label || text('subtitleOff');

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!subtitleSelectRef.current?.contains(event.target as Node)) {
        setSubtitleMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSubtitleMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function chooseSubtitleOption(value: string) {
    onChooseSubtitle(value);
    setSubtitleMenuOpen(false);
  }

  return (
    <div className="subtitle-bar">
      <div className="custom-select" ref={subtitleSelectRef}>
        <button
          aria-expanded={subtitleMenuOpen}
          aria-haspopup="listbox"
          className="custom-select-trigger"
          onClick={() => setSubtitleMenuOpen((open) => !open)}
          type="button"
        >
          <span>{selectedSubtitleLabel}</span>
          <ChevronDown aria-hidden="true" size={18} strokeWidth={2.4} />
        </button>

        {subtitleMenuOpen && (
          <div className="custom-select-menu" role="listbox">
            {subtitleOptions.map((option) => (
              <button
                aria-selected={subtitleSelection === option.id}
                className={`custom-select-option ${subtitleSelection === option.id ? 'active' : ''}`}
                key={option.id}
                onClick={() => chooseSubtitleOption(option.id)}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {subtitleSelection === option.id && <Check aria-hidden="true" size={16} strokeWidth={2.6} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        onChange={(event) => setSubtitleUrl(event.target.value)}
        placeholder={text('subtitleUrl')}
        type="url"
        value={subtitleUrl}
      />
      <button className="secondary" onClick={loadSubtitleFromUrl} type="button">
        {text('loadSubtitle')}
      </button>
      <label className="file-label">
        {text('localSubtitle')}
        <input accept=".vtt,text/vtt" onChange={loadSubtitleFromFile} type="file" />
      </label>
    </div>
  );
}

export function createWatchPath(id: string, context: WatchLinkContext): string {
  const params = new URLSearchParams();
  params.set('from', context.from);

  if (context.type) {
    params.set('type', context.type);
  }

  if (context.keyword) {
    params.set('wd', context.keyword);
  }

  if (context.page > 1) {
    params.set('page', String(context.page));
  }

  return `/watch/${id}?${params.toString()}`;
}

export function buildPagedPath(basePath: string, page: number): string {
  if (page <= 1) {
    return basePath;
  }

  return `${basePath}?page=${page}`;
}

export function getBackPath(params: URLSearchParams): string {
  const from = params.get('from');
  const page = params.get('page');

  if (from === 'search') {
    const wd = params.get('wd') || '';
    const searchParams = new URLSearchParams();

    if (wd) {
      searchParams.set('wd', wd);
    }

    if (page) {
      searchParams.set('page', page);
    }

    const query = searchParams.toString();
    return `/search${query ? `?${query}` : ''}`;
  }

  const type = params.get('type') || '';
  const searchParams = new URLSearchParams();

  if (page) {
    searchParams.set('page', page);
  }

  const query = searchParams.toString();
  return `${type ? `/category/${type}` : '/'}${query ? `?${query}` : ''}`;
}
