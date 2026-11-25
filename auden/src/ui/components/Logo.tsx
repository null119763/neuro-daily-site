/**
 * Auden mark: eight tapered rays — long vertical/horizontal rays and shorter, softer diagonals
 * (from the owner's app icon, docs/design/app-icon.jpg).
 */
const RAY = "M12 11.4C11.68 8.6 11.18 5.2 11.18 3.25a.82.82 0 0 1 1.64 0C12.82 5.2 12.32 8.6 12 11.4Z";

export function LogoMark({ size = 28, className = "logo-mark", title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {[0, 90, 180, 270].map((a) => (
        <path key={a} d={RAY} transform={`rotate(${a} 12 12)`} />
      ))}
      {[45, 135, 225, 315].map((a) => (
        <path key={a} d={RAY} opacity={0.72} transform={`rotate(${a} 12 12) translate(12 12) scale(0.74) translate(-12 -12)`} />
      ))}
    </svg>
  );
}

export function Hills() {
  return (
    <svg className="hills" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true" height="160" width="100%">
      <path d="M0 120 C80 70 140 90 210 60 C270 35 330 80 400 70 C470 60 520 30 600 50 L600 160 L0 160Z" fill="currentColor" opacity=".6" />
      <path d="M0 140 C90 110 160 130 240 100 C310 75 380 120 460 105 C520 95 560 85 600 95 L600 160 L0 160Z" fill="currentColor" />
    </svg>
  );
}
