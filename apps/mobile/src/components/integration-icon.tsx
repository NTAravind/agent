import React, { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { SvgXml } from 'react-native-svg';

/**
 * Renders an integration's own logo.
 *
 * Most Composio toolkit logos are served as SVG (`https://logos.composio.dev/api/...`),
 * which React Native's <Image> cannot render — those are fetched as markup and
 * drawn with react-native-svg instead. Logos that are raster images (png/jpg/
 * webp/gif) are handed straight to expo-image.
 *
 * When a logo is missing or cannot be drawn this renders nothing at all: no
 * stand-in icon is invented for it.
 */

/** URL suffixes that are raster images and can go straight to <Image>. */
const RASTER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'];

function isRaster(uri: string): boolean {
  const path = uri.split('?')[0].split('#')[0].toLowerCase();
  return RASTER_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Fetched SVG markup, keyed by URL. */
const svgCache = new Map<string, string>();

/** In-flight requests, so the same logo is never fetched twice at once. */
const inflight = new Map<string, Promise<string>>();

/** Stable no-op so parse failures never spam the console. */
const ignoreError = () => {};

function loadSvg(uri: string): Promise<string> {
  const cached = svgCache.get(uri);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(uri);
  if (existing) return existing;

  const request = fetch(uri)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!/<svg[\s>]/i.test(text)) throw new Error('Logo is not an SVG');
      svgCache.set(uri, text);
      return text;
    })
    .finally(() => {
      inflight.delete(uri);
    });

  inflight.set(uri, request);
  return request;
}

export function IntegrationIcon({
  uri,
  size = 28,
}: {
  /** The logo URL. When null/undefined nothing is rendered. */
  uri?: string | null;
  size?: number;
}) {
  const raster = uri ? isRaster(uri) : false;
  const [fetched, setFetched] = useState<{ uri: string; markup: string } | null>(null);

  useEffect(() => {
    if (!uri || raster) return;

    let active = true;
    loadSvg(uri)
      .then((markup) => {
        if (active) setFetched({ uri, markup });
      })
      .catch(() => {
        // A logo we cannot draw is simply left blank.
      });

    return () => {
      active = false;
    };
  }, [uri, raster]);

  const override = useMemo(() => ({ width: size, height: size }), [size]);

  if (!uri) return null;

  if (raster) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit="contain"
        accessibilityIgnoresInvertColors
      />
    );
  }

  // Prefer the shared cache so a logo that another row already fetched shows
  // up immediately, without waiting for this row's own request.
  const markup = svgCache.get(uri) ?? (fetched?.uri === uri ? fetched.markup : null);
  if (!markup) return null;

  return <SvgXml xml={markup} override={override} onError={ignoreError} />;
}
