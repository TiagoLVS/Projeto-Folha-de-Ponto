import type { ImgHTMLAttributes } from 'react';
/** PNG local, sem otimização de servidor; compartilhado entre Next e a SPA desktop. */
export function BrandImage({ alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
