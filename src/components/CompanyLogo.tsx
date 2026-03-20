import { useState } from 'react';

interface Props {
  name: string;
  domain?: string | null;
  jobLink?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-7 w-7 rounded-lg text-[10px]',
  md: 'h-10 w-10 rounded-xl text-xs',
  lg: 'h-14 w-14 rounded-2xl text-lg',
};

const imgSizeMap = {
  sm: 'h-7 w-7 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-14 w-14 rounded-2xl',
};

function extractDomain(jobLink?: string | null, companyDomain?: string | null): string | null {
  if (companyDomain) return companyDomain;
  if (!jobLink) return null;
  try {
    const host = new URL(jobLink).hostname;
    // Strip subdomains like "careers.company.com" → "company.com"
    const parts = host.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return host;
  } catch {
    return null;
  }
}

export default function CompanyLogo({ name, domain, jobLink, size = 'md' }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolvedDomain = extractDomain(jobLink, domain);

  const initials = name.split(/\s+/).map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  if (resolvedDomain && !imgFailed) {
    return (
      <img
        src={`https://logo.clearbit.com/${resolvedDomain}`}
        alt={`${name} logo`}
        className={`${imgSizeMap[size]} object-contain bg-white shrink-0`}
        onError={() => setImgFailed(true)}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${sizeMap[size]} flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${(hue + 40) % 360} 70% 55%))` }}
    >
      {initials}
    </div>
  );
}
