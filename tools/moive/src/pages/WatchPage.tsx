import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type Hls from 'hls.js';
import { fetchVideoDetail } from '../api';
import { useAppSettings } from '../App';
import { AppFrame, getBackPath, StatusLine, SubtitleControls } from '../components';
import { getDisplayTitle, getMetaParts, translateText } from '../i18n';
import type { Episode, SubtitleTrackOption, VideoDetail } from '../types';

type HlsConstructor = typeof import('hls.js').default;

let hlsLoader: Promise<HlsConstructor> | null = null;

function loadHlsConstructor(): Promise<HlsConstructor> {
  if (!hlsLoader) {
    hlsLoader = import('hls.js/light').then((module) => module.default as HlsConstructor);
  }

  return hlsLoader;
}

export default function WatchPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { contentLanguage, text } = useAppSettings();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);
  const [selectedEpisodeUrl, setSelectedEpisodeUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [translatedContent, setTranslatedContent] = useState('');
  const [translationNotice, setTranslationNotice] = useState('');
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackOption[]>([]);
  const [subtitleSelection, setSubtitleSelection] = useState('off');
  const [subtitleUrl, setSubtitleUrl] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const manualTrackRefs = useRef<HTMLTrackElement[]>([]);
  const subtitleObjectUrlRef = useRef('');

  const selectedSource = video?.sources[selectedSourceIndex] || null;
  const selectedTitle = video ? getDisplayTitle(video, contentLanguage) : text('selectVideo');
  const selectedMeta = video ? getMetaParts(video, contentLanguage).join(' · ') : '';
  const selectedContent = translatedContent || video?.content || '';
  const backPath = useMemo(() => getBackPath(searchParams), [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setStatus(text('loadingVideos'));

    fetchVideoDetail(id)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        const hlsSourceIndex = detail.sources.findIndex((source) =>
          source.episodes.some((episode) => episode.isHls)
        );
        const sourceIndex = hlsSourceIndex >= 0 ? hlsSourceIndex : 0;
        const source = detail.sources[sourceIndex];
        const firstEpisode = source?.episodes.find((episode) => episode.isHls) || source?.episodes[0];

        setVideo(detail);
        setSelectedSourceIndex(sourceIndex);
        setTranslatedContent(detail.content || '');
        setStatus(getDisplayTitle(detail, contentLanguage));

        if (firstEpisode) {
          window.setTimeout(() => {
            void playEpisode(firstEpisode, detail);
          }, 0);
        }
      })
      .catch((detailError: Error) => {
        if (!cancelled) {
          setError(detailError.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, text]);

  useEffect(() => {
    let cancelled = false;

    async function translateSelectedContent() {
      if (!video) {
        setTranslatedContent('');
        setTranslationNotice('');
        return;
      }

      const original = video.content || '';

      if (contentLanguage === 'original' || contentLanguage === 'zh') {
        setTranslatedContent(original);
        setTranslationNotice('');
        return;
      }

      const translated = await translateText(original, contentLanguage);

      if (!cancelled) {
        setTranslatedContent(translated);
        setTranslationNotice(translated === original ? text('translationFallback') : '');
      }
    }

    void translateSelectedContent();

    return () => {
      cancelled = true;
    };
  }, [contentLanguage, text, video]);

  useEffect(() => {
    return () => {
      destroyHls();
      clearManualSubtitles(true);
    };
  }, []);

  async function playEpisode(episode: Episode, currentVideo = video) {
    const player = videoRef.current;

    if (!player) {
      return;
    }

    destroyHls();
    resetSubtitleState();
    setSelectedEpisodeUrl(episode.url);
    setStatus(`${text('nowPlaying')}: ${episode.name}`);

    if (episode.isHls && player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = episode.url;
      syncNativeSubtitleTracks();
    } else if (episode.isHls) {
      const HlsConstructor = await loadHlsConstructor();

      if (!HlsConstructor.isSupported()) {
        setError(text('hlsUnsupported'));
        return;
      }

      const hls = new HlsConstructor({
        enableWorker: true,
        lowLatencyMode: false,
      });

      hls.on(HlsConstructor.Events.SUBTITLE_TRACKS_UPDATED, () => {
        setSubtitleTracks(getHlsSubtitleTracks(hls));
      });
      hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
        setSubtitleTracks(getHlsSubtitleTracks(hls));
      });
      hls.loadSource(episode.url);
      hls.attachMedia(player);
      hlsRef.current = hls;
    } else {
      player.src = episode.url;
      syncNativeSubtitleTracks();
    }

    player.play().catch(() => {});

    if (currentVideo) {
      setStatus(`${text('nowPlaying')}: ${getDisplayTitle(currentVideo, contentLanguage)} ${episode.name}`);
    }
  }

  function chooseSource(index: number) {
    setSelectedSourceIndex(index);
    const source = video?.sources[index];
    const firstEpisode = source?.episodes.find((episode) => episode.isHls) || source?.episodes[0];

    if (firstEpisode) {
      void playEpisode(firstEpisode, video);
    }
  }

  function destroyHls() {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  function resetSubtitleState() {
    clearManualSubtitles(false);
    setSubtitleTracks([]);
    setSubtitleSelection('off');
  }

  function clearManualSubtitles(revokeUrl: boolean) {
    for (const track of manualTrackRefs.current) {
      track.remove();
    }

    manualTrackRefs.current = [];

    if (revokeUrl && subtitleObjectUrlRef.current) {
      URL.revokeObjectURL(subtitleObjectUrlRef.current);
      subtitleObjectUrlRef.current = '';
    }
  }

  function syncNativeSubtitleTracks() {
    window.setTimeout(() => {
      const player = videoRef.current;

      if (!player) {
        return;
      }

      const tracks = [...player.textTracks]
        .filter((track) => track.kind === 'subtitles' || track.kind === 'captions')
        .map((track, index) => ({
          id: `native:${index}`,
          label: track.label || track.language || `${text('embeddedSubtitle')} ${index + 1}`,
          nativeTrack: track,
        }));

      setSubtitleTracks(tracks);
    }, 300);
  }

  function getHlsSubtitleTracks(hls: Hls): SubtitleTrackOption[] {
    return hls.subtitleTracks.map((track, index) => ({
      id: `hls:${index}`,
      label: track.name || track.lang || `${text('embeddedSubtitle')} ${index + 1}`,
      hlsIndex: index,
    }));
  }

  function loadSubtitleFromUrl() {
    const value = subtitleUrl.trim();

    if (!value) {
      return;
    }

    addManualSubtitle(value, text('externalSubtitle'));
  }

  function loadSubtitleFromFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (subtitleObjectUrlRef.current) {
      URL.revokeObjectURL(subtitleObjectUrlRef.current);
    }

    subtitleObjectUrlRef.current = URL.createObjectURL(file);
    addManualSubtitle(subtitleObjectUrlRef.current, file.name.replace(/\.vtt$/i, '') || text('localSubtitle'));
    event.target.value = '';
  }

  function addManualSubtitle(src: string, label: string) {
    const player = videoRef.current;

    if (!player) {
      return;
    }

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = label;
    track.srclang = inferSubtitleLang(label);
    track.src = src;
    player.appendChild(track);
    manualTrackRefs.current.push(track);

    const trackId = `manual:${manualTrackRefs.current.length - 1}`;
    setSubtitleTracks((tracks) => [...tracks, { id: trackId, label, manualTrack: track }]);

    window.setTimeout(() => {
      setSubtitleSelection(trackId);
      applySubtitleSelection(trackId);
    }, 100);
  }

  function chooseSubtitle(value: string) {
    setSubtitleSelection(value);
    applySubtitleSelection(value);
  }

  function applySubtitleSelection(value: string) {
    const player = videoRef.current;

    if (!player) {
      return;
    }

    for (const track of player.textTracks) {
      track.mode = 'disabled';
    }

    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = -1;
    }

    if (value === 'off') {
      return;
    }

    const track = subtitleTracks.find((item) => item.id === value);

    if (!track) {
      return;
    }

    if (track.hlsIndex !== undefined && hlsRef.current) {
      hlsRef.current.subtitleTrack = track.hlsIndex;
      return;
    }

    if (track.nativeTrack) {
      track.nativeTrack.mode = 'showing';
      return;
    }

    if (track.manualTrack?.track) {
      track.manualTrack.track.mode = 'showing';
    }
  }

  return (
    <AppFrame eyebrow="" headerTitle={selectedTitle} hideBrandText showHeading={false} subtitle="" title={selectedTitle}>
      <Link className="back-link watch-back" to={backPath}>{text('watchBack')}</Link>

      <div className="watch-layout">
        <section className="player-panel">
          <video controls playsInline ref={videoRef} />
          <SubtitleControls
            loadSubtitleFromFile={loadSubtitleFromFile}
            loadSubtitleFromUrl={loadSubtitleFromUrl}
            setSubtitleUrl={setSubtitleUrl}
            subtitleSelection={subtitleSelection}
            subtitleTracks={subtitleTracks}
            subtitleUrl={subtitleUrl}
            text={text}
            onChooseSubtitle={chooseSubtitle}
          />
          <article className="player-copy">
            <h1>{selectedTitle}</h1>
            <p className="detail-line">{selectedMeta || text('noInfo')}</p>
            {video?.alias && <p className="detail-line">{text('alias')}: {video.alias}</p>}
            {video && (video.director || video.actor) && (
              <p className="detail-line">
                {[video.director ? `${text('director')}: ${video.director}` : '',
                  video.actor ? `${text('actor')}: ${video.actor}` : '']
                  .filter(Boolean)
                  .join('  ')}
              </p>
            )}
            <p className="detail-line summary">{selectedContent || text('noSummary')}</p>
            {translationNotice && <p className="notice">{translationNotice}</p>}
          </article>
        </section>

        <aside className="detail-panel">
          <StatusLine error={error} loading={loading} status={status} />

          {video ? (
            <>
              <h2>{text('source')}</h2>
              <div className="sources">
                {video.sources.map((source, index) => (
                  <button
                    className={`chip ${index === selectedSourceIndex ? 'active' : ''}`}
                    key={`${source.name}-${index}`}
                    onClick={() => chooseSource(index)}
                    type="button"
                  >
                    {source.name}
                  </button>
                ))}
              </div>

              <h2>{text('episodes')}</h2>
              <div className="episodes">
                {selectedSource?.episodes.length ? (
                  selectedSource.episodes.map((episode) => (
                    <button
                      className={`chip episode ${episode.url === selectedEpisodeUrl ? 'active' : ''}`}
                      key={episode.url}
                      onClick={() => void playEpisode(episode)}
                      title={episode.name}
                      type="button"
                    >
                      {episode.name}
                    </button>
                  ))
                ) : (
                  <div className="empty-state compact">{text('noEpisodes')}</div>
                )}
              </div>
            </>
          ) : (
            <p className="detail-line">{text('selectHint')}</p>
          )}
        </aside>
      </div>
    </AppFrame>
  );
}

function inferSubtitleLang(label: string): string {
  if (/英|en/i.test(label)) {
    return 'en';
  }

  if (/日|ja/i.test(label)) {
    return 'ja';
  }

  if (/韩|ko/i.test(label)) {
    return 'ko';
  }

  return 'zh';
}
