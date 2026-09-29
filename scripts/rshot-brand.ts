import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import opentype from "opentype.js";
import { SITE } from "@aihot/industry/site";

const root = path.resolve(import.meta.dirname, "..");
const brand = path.join(root, "industry/brand");
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#123e43"/><circle cx="256" cy="256" r="142" fill="none" stroke="#72d5c7" stroke-width="18"/><ellipse cx="256" cy="256" rx="86" ry="142" fill="none" stroke="#72d5c7" stroke-width="9"/><path d="M118 225h276M125 302h262" fill="none" stroke="#72d5c7" stroke-width="9"/><path d="M156 363 352 155" stroke="#f5e6b8" stroke-width="19" stroke-linecap="round"/><rect x="322" y="105" width="67" height="67" rx="14" transform="rotate(42 355 138)" fill="#f5e6b8"/><circle cx="173" cy="347" r="17" fill="#f5e6b8"/></svg>`;
writeFileSync(path.join(brand, "logo.svg"), mark);
for (const [file, size] of [["icon.png", 512], ["icon-192.png", 192], ["apple-icon.png", 180]] as const) {
  await sharp(Buffer.from(mark)).resize(size, size).png().toFile(path.join(brand, file));
}
const buf = readFileSync(path.join(root, "assets/og-fonts/noto-sans-sc-700.ttf"));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const boxes: Record<string, string> = {};
for (const [kind, suffix] of Object.entries({ daily: "日报", weekly: "周报", monthly: "月报", archive: "日报合订本" })) {
  const subject = kind === "archive" ? "" : SITE.subject;
  const first = font.getPath(subject, 12, 210, 200);
  const advance = subject ? font.getAdvanceWidth(subject, 200) + 30 : 12;
  const second = font.getPath(suffix, advance, 210, 200);
  const width = advance + font.getAdvanceWidth(suffix, 200) + 12;
  const viewBox = `0 0 ${Math.ceil(width)} 250`;
  boxes[kind] = viewBox;
  writeFileSync(path.join(brand, "nameplates", `${kind}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path fill="#176b75" d="${first.toPathData(2)}"/><path fill="currentColor" d="${second.toPathData(2)}"/></svg>\n`);
}
writeFileSync(path.join(brand, "nameplates/index.json"), `${JSON.stringify(boxes, null, 2)}\n`);
console.log("RSHOT logo, icons and report nameplates generated");
