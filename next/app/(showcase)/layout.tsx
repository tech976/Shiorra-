import { SmoothScrollProvider } from '@/components/showcase/SmoothScrollProvider';

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return <SmoothScrollProvider>{children}</SmoothScrollProvider>;
}
