/**
 * Text broken into lines of at most `max` characters for a narrow panel: wherever the
 * text has a run of two or more spaces (how the HUD separates its parts) a new line
 * starts, and each part is wrapped at word boundaries. A word longer than a line is
 * cut. Lines given in the text are kept.
 */
export function wrapLines(text: string, max: number): string {
  if (max < 1) return text;
  const lines: string[] = [];
  for (const given of text.split('\n')) {
    for (const part of given.split(/ {2,}/)) {
      let line = '';
      for (const word of part.split(' ').filter((w) => w !== '')) {
        for (let w = word; w.length > 0; w = w.slice(max)) {
          const piece = w.slice(0, max);
          if (line === '') line = piece;
          else if (line.length + 1 + piece.length <= max) line += ` ${piece}`;
          else {
            lines.push(line);
            line = piece;
          }
        }
      }
      lines.push(line);
    }
  }
  return lines.join('\n');
}
