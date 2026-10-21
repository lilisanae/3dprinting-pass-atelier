import type { Project } from './types';

export type WorkshopKind = 'pass' | 'badge';
export const workshopNames = { pass: '通行证工坊', badge: '徽章工坊' };
export const projectWorkshop = (project: Project): WorkshopKind =>
  project.format === 'badge-atelier' ? 'badge' : 'pass';
export function workshopFromLocation(
  location: Pick<Location, 'pathname' | 'search'>,
): WorkshopKind {
  return /^\/(?:atelier\/)?badge(?:\/|$)/.test(location.pathname) ||
    new URLSearchParams(location.search).get('workshop') === 'badge'
    ? 'badge'
    : 'pass';
}
/** Public entrances share an origin; standalone builds also work without a router. */
export function workshopHref(
  kind: WorkshopKind,
  location: Pick<Location, 'hostname' | 'pathname'>,
): string {
  return location.hostname === 'beatsanae.cn' ||
    /^\/(?:atelier\/)?(?:pass|badge)\//.test(location.pathname)
    ? `/${kind}/`
    : kind === 'badge'
      ? '/?workshop=badge'
      : '/';
}
