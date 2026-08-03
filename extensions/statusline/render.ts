import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FooterSegment {
  text: string;
}

function appendSegment(lines: string[], segment: string, width: number): void {
  const current = lines.at(-1) ?? "";
  const next = current ? `${current}  ${segment}` : segment;
  if (visibleWidth(next) <= width) {
    lines[lines.length - 1] = next;
    return;
  }

  lines.push(truncateToWidth(segment, width));
}

export function renderFooter(
  primary: FooterSegment[],
  statuses: ReadonlyMap<string, string>,
  width: number,
): string[] {
  if (width <= 0) return [];

  const lines = [""];
  for (const segment of primary) appendSegment(lines, segment.text, width);

  for (const [key, value] of statuses) {
    appendSegment(lines, `${key}: ${value}`, width);
  }

  return lines.filter(Boolean).map((line) => truncateToWidth(line, width));
}
