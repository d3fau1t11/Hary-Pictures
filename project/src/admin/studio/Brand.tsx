import { Link } from 'react-router-dom';

// Derived from the original company artwork in public/20250423_215536.jpg.
export function BrandMark({ className = '', decorative = false }: { className?: string; decorative?: boolean }) {
  return <img className={'studio-brand-mark ' + className} src="/Image/hary-brand-mark.webp" width={40} height={40} alt={decorative ? '' : 'Hary Pictures'} />;
}

export default function Brand({ to = '/admin/library' }: { to?: string }) {
  return <Link to={to} className="studio-brand"><BrandMark decorative /><span>HARY PICTURES<small>THE STUDIO</small></span></Link>;
}
