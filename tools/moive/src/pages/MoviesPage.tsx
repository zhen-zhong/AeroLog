import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clampPage, fetchCategories, fetchVideos } from '../api';
import { useAppSettings } from '../App';
import { AppFrame, buildPagedPath, CategoryRow, Pager, StatusLine, VideoGrid } from '../components';
import { localizeCategoryName } from '../i18n';
import type { Category, VideoSummary } from '../types';

const TOP_CATEGORY_ORDER = ['1', '2', '4', '3', '35', '36'];
const CHILD_CATEGORY_ORDER: Record<string, string[]> = {
  1: ['6', '7', '9', '10', '8', '11', '12', '20', '47', '34', '45'],
  2: ['13', '16', '14', '15', '21', '22', '23', '24', '46'],
  3: ['25', '26', '27', '28'],
  4: ['29', '30', '31', '32', '33'],
  36: ['37', '38', '39', '40'],
};

export default function MoviesPage() {
  const { typeId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = clampPage(searchParams.get('page'));
  const { contentLanguage, text } = useAppSettings();
  const [categories, setCategories] = useState<Category[]>([]);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingCategories(true);
    setStatus(text('loadingCategories'));

    fetchCategories()
      .then((items) => {
        if (!cancelled) {
          setCategories(items);
        }
      })
      .catch((categoryError: Error) => {
        if (!cancelled) {
          setError(categoryError.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCategories(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [text]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadingVideos(true);
    setError('');
    setStatus(text('loadingVideos'));

    fetchVideos({ type: typeId, page })
      .then((data) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setVideos(data.videos);
        setPageCount(data.pageCount || 1);
        setStatus(text('categoryList'));
      })
      .catch((listError: Error) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(listError.message);
        setVideos([]);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoadingVideos(false);
        }
      });
  }, [page, text, typeId]);

  const topCategories = useMemo(() => {
    return categories
      .filter((item) => item.pid === '0')
      .sort((a, b) => {
        const aIndex = TOP_CATEGORY_ORDER.indexOf(a.id);
        const bIndex = TOP_CATEGORY_ORDER.indexOf(b.id);

        if (aIndex >= 0 || bIndex >= 0) {
          return (aIndex >= 0 ? aIndex : 999) - (bIndex >= 0 ? bIndex : 999);
        }

        return Number(a.id) - Number(b.id);
      });
  }, [categories]);

  const activeParentId = useMemo(() => {
    const category = categories.find((item) => item.id === typeId);

    if (!category) {
      return '';
    }

    return category.pid === '0' ? category.id : category.pid;
  }, [categories, typeId]);

  const childCategories = useMemo(() => {
    const order = CHILD_CATEGORY_ORDER[activeParentId] || [];

    return categories
      .filter((item) => item.pid === activeParentId)
      .sort((a, b) => {
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);

        if (aIndex >= 0 || bIndex >= 0) {
          return (aIndex >= 0 ? aIndex : 999) - (bIndex >= 0 ? bIndex : 999);
        }

        return Number(a.id) - Number(b.id);
      });
  }, [activeParentId, categories]);

  const pageTitle = typeId
    ? localizeCategoryName(categories.find((item) => item.id === typeId)?.name || text('moviesTitle'), contentLanguage)
    : text('moviesTitle');

  function categoryLink(id: string): string {
    return id ? `/category/${id}` : '/';
  }

  function goToPage(nextPage: number) {
    const basePath = typeId ? `/category/${typeId}` : '/';
    navigate(buildPagedPath(basePath, nextPage));
  }

  return (
    <AppFrame eyebrow={text('navMovies')} subtitle={text('moviesSubtitle')} title={pageTitle}>
      <section className="filter-panel">
        <CategoryRow
          activeId={activeParentId}
          allActive={!activeParentId}
          allLabel={text('all')}
          categories={topCategories}
          contentLanguage={contentLanguage}
          linkFor={categoryLink}
        />

        {childCategories.length > 0 && (
          <CategoryRow
            activeId={typeId}
            allActive={typeId === activeParentId}
            allLabel={`${text('allPrefix')}${localizeCategoryName(
              categories.find((item) => item.id === activeParentId)?.name || '',
              contentLanguage
            )}`}
            categories={childCategories}
            contentLanguage={contentLanguage}
            linkFor={(id) => categoryLink(id || activeParentId)}
          />
        )}

        <StatusLine error={error} loading={loadingCategories || loadingVideos} status={status} />
      </section>

      <VideoGrid
        contentLanguage={contentLanguage}
        emptyText={text('noResult')}
        loading={loadingVideos}
        text={text}
        videos={videos}
        watchContext={{ from: 'movies', page, type: typeId }}
      />

      <Pager onPage={goToPage} page={page} pageCount={pageCount} text={text} />
    </AppFrame>
  );
}
