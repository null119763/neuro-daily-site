/** Preliminary Auden mark: a four-point spark. Trademark clearance pending (DECISIONS P6). */
export function LogoMark({ size = 28, className = "logo-mark" }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M12 1.8c.55 5.3 3.6 8.55 9.2 10.2-5.6 1.65-8.65 4.9-9.2 10.2-.55-5.3-3.6-8.55-9.2-10.2C8.4 10.35 11.45 7.1 12 1.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ href = "/", size = 28 }: { href?: string; size?: number }) {
  return (
    <a className="brand" href={href} aria-label="Auden">
      <LogoMark size={size} />
      <span className="brand-name">Auden</span>
    </a>
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
