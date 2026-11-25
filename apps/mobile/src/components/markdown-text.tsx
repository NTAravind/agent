import React, { useMemo } from 'react';
import { Linking } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { colors, radius } from '@/theme';

type Props = {
  /** Raw markdown string */
  markdown: string;
  /** Pass true while the LLM is still streaming tokens */
  streaming?: boolean;
  /** Override text size (default: 17) */
  fontSize?: number;
  /** Override text color */
  color?: string;
  onStreamingEnd?: () => void;
};

/** Base paragraph size the library's default headings are designed against. */
const BASE_FONT_SIZE = 16;

/** Library default heading sizes (see headingDefaults.ts). */
const HEADING_SIZES = { h1: 30, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14 };

/**
 * App-wide Markdown renderer using react-native-enriched-markdown.
 *
 * - Renders natively (no WebView): bold, italic, headers, lists, tables, code.
 * - `flavor="github"` enables GFM tables and the code-block header/copy bar.
 * - Pass `streaming={true}` while an AI response is in-flight so incomplete
 *   syntax (open code fences, bold markers, tables) is held back or repaired
 *   until the stream closes; set it back to false when the stream ends or the
 *   final render keeps doing that.
 * - Tapped links open in the system browser via Linking.openURL.
 *
 * The style object is memoized: EnrichedMarkdownText re-parses on every
 * render, so an inline object would cost us a parse per chunk while streaming.
 */
export function MarkdownText({
  markdown,
  streaming = false,
  fontSize = 17,
  color = colors.textPrimary,
  onStreamingEnd,
}: Props) {
  const markdownStyle = useMemo<MarkdownStyle>(() => {
    // Keep headings proportional when the caller overrides the body size
    // (e.g. the 13pt reasoning trace), so an h1 doesn't render at 30pt.
    const scale = fontSize / BASE_FONT_SIZE;
    const heading = (size: number) => ({
      fontSize: Math.round(size * scale),
      color,
    });

    return {
      paragraph: { fontSize, lineHeight: Math.round(fontSize * 1.35), color },
      h1: heading(HEADING_SIZES.h1),
      h2: heading(HEADING_SIZES.h2),
      h3: heading(HEADING_SIZES.h3),
      h4: heading(HEADING_SIZES.h4),
      h5: heading(HEADING_SIZES.h5),
      h6: heading(HEADING_SIZES.h6),
      codeBlock: {
        fontSize: Math.max(Math.round(fontSize * 0.85), 11),
        backgroundColor: colors.surfaceRaised,
        borderRadius: radius.tile,
        padding: 10,
        marginBottom: 8,
      },
      code: {
        backgroundColor: colors.surfaceRaised,
        borderRadius: radius.tile,
        paddingHorizontal: 4,
      },
      link: { color: colors.link, underline: true },
    };
  }, [fontSize, color]);

  return (
    <EnrichedMarkdownText
      markdown={markdown}
      flavor="github"
      streaming={streaming}
      {...(onStreamingEnd ? { onStreamingEnd } : {})}
      onLinkPress={({ url }) => void Linking.openURL(url)}
      markdownStyle={markdownStyle}
    />
  );
}
