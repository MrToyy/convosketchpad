interface ConvoSketchpadLogoProps {
  /** Rendered size in CSS pixels. @default 28 */
  size?: number;
}

/** Shared ConvoSketchpad logo used by the product shell and access flows. */
export default function ConvoSketchpadLogo({ size = 28 }: ConvoSketchpadLogoProps) {
  return (
    <img
      src="/convosketchpad-logo-1024.png"
      alt="ConvoSketchpad"
      width={size}
      height={size}
      draggable={false}
      style={{ display: 'block', width: size, height: size }}
    />
  );
}
