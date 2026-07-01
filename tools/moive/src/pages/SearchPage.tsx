import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clampPage, searchVideos } from '../api';
import { useAppSettings } from '../App';
import { AppFrame, Pager, StatusLine, VideoGrid } from '../components';
import type { VideoSummary } from '../types';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { contentLanguage, text } = useAppSettings();
  const keyword = searchParams.get('wd') || '';
  const page = clampPage(searchParams.get('page'));
  const [searchInput, setSearchInput] = useState(keyword);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setSearchInput(keyword);
  }, [keyword]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!keyword.trim()) {
      setVideos([]);
      setPageCount(1);
      setStatus(text('selectHint'));
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setStatus(text('loadingVideos'));

    searchVideos({ keyword, page })
      .then((data) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setVideos(data.videos);
        setPageCount(data.pageCount || 1);
        setStatus(`${text('searching')}: ${keyword}`);
      })
      .catch((searchError: Error) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(searchError.message);
        setVideos([]);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      });
  }, [keyword, page, text]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKeyword = searchInput.trim();

    if (!nextKeyword) {
      navigate('/search');
      return;
    }

    navigate(`/search?wd=${encodeURIComponent(nextKeyword)}`);
  }

  function goToPage(nextPage: number) {
    const params = new URLSearchParams();
    params.set('wd', keyword);

    if (nextPage > 1) {
      params.set('page', String(nextPage));
    }

    navigate(`/search?${params.toString()}`);
  }

  const backButton = (
    <button className="back-link page-back" onClick={() => navigate(-1)} type="button">
      <ArrowLeft aria-hidden="true" size={17} strokeWidth={2.4} />
      {text('watchBack')}
    </button>
  );

  return (
    <AppFrame
      eyebrow={text('navSearch')}
      headingBefore={backButton}
      subtitle={text('searchSubtitle')}
      title={text('searchTitle')}
    >
      <form className="search-panel" onSubmit={submitSearch}>
        <input
          autoComplete="off"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={text('searchPlaceholder')}
          type="search"
          value={searchInput}
        />
        <button className="primary" type="submit">{text('search')}</button>
      </form>

      <StatusLine error={error} loading={loading} status={status} />

      <VideoGrid
        contentLanguage={contentLanguage}
        emptyText={text('noResult')}
        loading={loading}
        text={text}
        videos={videos}
        watchContext={{ from: 'search', keyword, page }}
      />

      {keyword && <Pager onPage={goToPage} page={page} pageCount={pageCount} text={text} />}
    </AppFrame>
  );
}
