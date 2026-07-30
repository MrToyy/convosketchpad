import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const outputDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(outputDir, '..', '..');
const width = 1280;
const height = 640;

const [logo, screenshot] = await Promise.all([
  readFile(join(rootDir, 'public', 'convosketchpad-logo-1024.png')),
  readFile(join(rootDir, 'public', 'screenshot.png')),
]);

const logoData = `data:image/png;base64,${logo.toString('base64')}`;
const screenshotData = `data:image/png;base64,${screenshot.toString('base64')}`;

const palette = {
  background: '#070b12',
  backgroundRaised: '#0d141f',
  border: '#273244',
  orange: '#f2aa4b',
  orangeSoft: '#d98b35',
  text: '#f8fafc',
  muted: '#a8b1bf',
  green: '#72d39d',
};

const defs = `
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.backgroundRaised}" />
      <stop offset="58%" stop-color="${palette.background}" />
      <stop offset="100%" stop-color="#05070c" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${palette.orange}" stop-opacity="0.22" />
      <stop offset="100%" stop-color="${palette.orange}" stop-opacity="0" />
    </radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#5f6b7d" stroke-opacity="0.08" stroke-width="1" />
    </pattern>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000000" flood-opacity="0.55" />
    </filter>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.5" />
    </filter>
    <clipPath id="screen-a"><rect x="606" y="167" width="610" height="282" rx="15" /></clipPath>
    <clipPath id="screen-b"><rect x="574" y="130" width="642" height="297" rx="15" /></clipPath>
    <clipPath id="screen-c"><rect x="616" y="155" width="600" height="277" rx="15" /></clipPath>
    <clipPath id="screen-d"><rect x="90" y="310" width="1100" height="270" rx="18" /></clipPath>
  </defs>
`;

const base = `
  <rect width="${width}" height="${height}" fill="url(#background)" />
  <rect width="${width}" height="${height}" fill="url(#grid)" />
`;

const logoLockup = ({ x, y, logoSize = 58, nameSize = 32 }) => `
  <image href="${logoData}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}" />
  <text x="${x + logoSize + 18}" y="${y + logoSize * 0.66}" fill="${palette.text}"
    font-family="Inter, Arial, sans-serif" font-size="${nameSize}" font-weight="700"
    letter-spacing="-0.6">ConvoSketchpad</text>
`;

const badge = ({ x, y, text, color = palette.muted, stroke = palette.border, width: fixedWidth }) => {
  const badgeWidth = fixedWidth ?? Math.max(84, text.length * 8 + 30);
  return `
    <rect x="${x}" y="${y}" width="${badgeWidth}" height="34" rx="17"
      fill="#0c131e" stroke="${stroke}" stroke-width="1" />
    <text x="${x + badgeWidth / 2}" y="${y + 22}" text-anchor="middle" fill="${color}"
      font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600">${text}</text>
  `;
};

const screenshotCard = ({ x, y, w, h, clipId }) => `
  <rect x="${x - 8}" y="${y - 8}" width="${w + 16}" height="${h + 16}" rx="22"
    fill="#111923" stroke="${palette.border}" stroke-width="1.5" filter="url(#shadow)" />
  <image href="${screenshotData}" x="${x}" y="${y}" width="${w}" height="${h}"
    preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})" />
`;

const directions = [
  {
    id: 'product-first',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${defs}
        ${base}
        <ellipse cx="1000" cy="320" rx="410" ry="360" fill="url(#glow)" />
        <path d="M540 300 C570 300 572 248 604 248 M540 300 C570 300 572 360 604 360"
          fill="none" stroke="${palette.orange}" stroke-opacity="0.7" stroke-width="3" />
        <circle cx="538" cy="300" r="7" fill="${palette.orange}" />
        <circle cx="604" cy="248" r="6" fill="${palette.orange}" />
        <circle cx="604" cy="360" r="6" fill="${palette.orange}" />
        ${logoLockup({ x: 64, y: 56 })}
        <text x="64" y="180" fill="${palette.text}" font-family="Inter, Arial, sans-serif"
          font-size="45" font-weight="750" letter-spacing="-1.4">
          <tspan x="64" dy="0">Fork OpenClaw</tspan>
          <tspan x="64" dy="54">conversations</tspan>
          <tspan x="64" dy="54">without losing context.</tspan>
        </text>
        <text x="64" y="386" fill="${palette.muted}" font-family="Inter, Arial, sans-serif"
          font-size="20" font-weight="450">
          <tspan x="64" dy="0">Context, attachments, and artifacts</tspan>
          <tspan x="64" dy="30">stay intact across every branch.</tspan>
        </text>
        ${badge({ x: 64, y: 474, text: 'OpenClaw' })}
        ${badge({ x: 172, y: 474, text: 'Visual workspace' })}
        ${badge({ x: 346, y: 474, text: 'Self-hosted' })}
        ${badge({ x: 478, y: 474, text: 'MIT', color: palette.green, stroke: '#28523d' })}
        <text x="64" y="562" fill="${palette.orange}" font-family="Inter, Arial, sans-serif"
          font-size="18" font-weight="650">让想法自由分支</text>
        ${screenshotCard({ x: 606, y: 167, w: 610, h: 282, clipId: 'screen-a' })}
        <text x="1216" y="494" text-anchor="end" fill="${palette.muted}"
          font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600">
          github.com/MrToyy/convosketchpad
        </text>
      </svg>
    `,
  },
  {
    id: 'brand-first',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${defs}
        ${base}
        <ellipse cx="830" cy="250" rx="520" ry="440" fill="url(#glow)" />
        ${logoLockup({ x: 64, y: 58, logoSize: 66, nameSize: 35 })}
        <text x="64" y="202" fill="${palette.orange}" font-family="Inter, Arial, sans-serif"
          font-size="19" font-weight="700" letter-spacing="0.3">VISUAL BRANCHING FOR OPENCLAW</text>
        <text x="64" y="276" fill="${palette.text}" font-family="Inter, Arial, sans-serif"
          font-size="40" font-weight="750" letter-spacing="-1">
          <tspan x="64" dy="0">Explore every path.</tspan>
          <tspan x="64" dy="50">Keep the main line clear.</tspan>
        </text>
        <text x="64" y="404" fill="${palette.muted}" font-family="Inter, Arial, sans-serif"
          font-size="20">
          <tspan x="64" dy="0">Fork any conversation with context, attachments,</tspan>
          <tspan x="64" dy="30">and artifacts intact.</tspan>
        </text>
        ${badge({ x: 64, y: 490, text: 'OpenClaw' })}
        ${badge({ x: 172, y: 490, text: 'Visual workspace' })}
        ${badge({ x: 346, y: 490, text: 'Self-hosted' })}
        ${badge({ x: 478, y: 490, text: 'MIT', color: palette.green, stroke: '#28523d' })}
        ${screenshotCard({ x: 574, y: 130, w: 642, h: 297, clipId: 'screen-b' })}
        <text x="1216" y="472" text-anchor="end" fill="${palette.muted}"
          font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600">
          github.com/MrToyy/convosketchpad
        </text>
        <path d="M518 336 C546 336 546 286 566 286 M518 336 C546 336 546 382 566 382"
          fill="none" stroke="${palette.orange}" stroke-width="3" stroke-opacity="0.8" />
        <circle cx="516" cy="336" r="7" fill="${palette.orange}" />
      </svg>
    `,
  },
  {
    id: 'chinese-first',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${defs}
        ${base}
        <ellipse cx="990" cy="310" rx="430" ry="370" fill="url(#glow)" />
        ${logoLockup({ x: 64, y: 54, logoSize: 60, nameSize: 32 })}
        <text x="64" y="210" fill="${palette.text}"
          font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif"
          font-size="58" font-weight="750" letter-spacing="-1.5">让想法自由分支</text>
        <text x="64" y="276" fill="${palette.orange}"
          font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif"
          font-size="31" font-weight="650">OpenClaw 可视化分支工作台</text>
        <text x="64" y="346" fill="${palette.muted}"
          font-family="PingFang SC, Noto Sans CJK SC, Arial, sans-serif"
          font-size="21">
          <tspan x="64" dy="0">从任意对话节点携带上下文、附件与生成物</tspan>
          <tspan x="64" dy="34">继续探索，同时保持任务主线清晰。</tspan>
        </text>
        ${badge({ x: 64, y: 452, text: 'OpenClaw' })}
        ${badge({ x: 172, y: 452, text: '可视化分支', width: 108 })}
        ${badge({ x: 296, y: 452, text: '开源 · 自托管', width: 126, color: palette.green, stroke: '#28523d' })}
        ${screenshotCard({ x: 616, y: 155, w: 600, h: 277, clipId: 'screen-c' })}
        <text x="1216" y="478" text-anchor="end" fill="${palette.muted}"
          font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600">
          github.com/MrToyy/convosketchpad
        </text>
      </svg>
    `,
  },
  {
    id: 'minimal-global',
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${defs}
        ${base}
        <ellipse cx="640" cy="460" rx="560" ry="330" fill="url(#glow)" />
        ${logoLockup({ x: 68, y: 48, logoSize: 54, nameSize: 30 })}
        <text x="1212" y="84" text-anchor="end" fill="${palette.muted}"
          font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600">OPENCLAW · SELF-HOSTED · MIT</text>
        <text x="640" y="202" text-anchor="middle" fill="${palette.text}"
          font-family="Inter, Arial, sans-serif" font-size="52" font-weight="760" letter-spacing="-1.5">
          Branch conversations visually.
        </text>
        <text x="640" y="252" text-anchor="middle" fill="${palette.muted}"
          font-family="Inter, Arial, sans-serif" font-size="22">
          Context, attachments, and artifacts stay intact.
        </text>
        <rect x="82" y="302" width="1116" height="286" rx="24"
          fill="#111923" stroke="${palette.border}" stroke-width="1.5" filter="url(#shadow)" />
        <image href="${screenshotData}" x="90" y="310" width="1100" height="509"
          preserveAspectRatio="xMidYMin meet" clip-path="url(#screen-d)" />
        <rect x="90" y="538" width="1100" height="42" fill="url(#background)" opacity="0.45" />
      </svg>
    `,
  },
];

await mkdir(outputDir, { recursive: true });

for (const direction of directions) {
  const pngPath = join(outputDir, `${direction.id}.png`);
  const svg = direction.svg.trim();
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
}

console.log(`Generated ${directions.length} social previews in ${outputDir}`);
