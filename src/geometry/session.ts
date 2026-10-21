import type { BadgeBase } from '../model/badge';
import type { ShapeAppearance } from '../model/shapeCatalog';
import type GeometryClient from './client';
import type { Project, Selection, TemplateData } from '../model/types';
import type { BadgeVectorShape } from '../model/badge';

/** Own a lazy worker; loading failures can retry without replacing the design. */
export class GeometrySession {
  private pending?: Promise<GeometryClient>;
  private disposed = false;
  constructor(
    template: TemplateData,
    private load = () => import('./client').then(({ default: Client }) => new Client(template)),
  ) {}
  private getClient() {
    if (this.disposed) return Promise.reject(new Error('几何计算已关闭。'));
    return (this.pending ??= this.load()
      .then((client) => {
        if (this.disposed) {
          client.dispose();
          throw new Error('几何计算已关闭。');
        }
        return client;
      })
      .catch((error) => {
        this.pending = undefined;
        throw error;
      }));
  }
  async generate(project: Project) {
    return (await this.getClient()).generate(project);
  }
  async merge(project: Project, selection: Selection) {
    return (await this.getClient()).merge(project, selection);
  }
  async inspectColors(project: Project, width: number) {
    return (await this.getClient()).inspectColors(project, width);
  }
  async normalizeBadgeOutline(shapes: BadgeVectorShape[]) {
    return (await this.getClient()).normalizeBadgeOutline(shapes);
  }
  async styleBadgeBase(base: BadgeBase, appearance: ShapeAppearance) {
    return (await this.getClient()).styleBadgeBase(base, appearance);
  }
  dispose() {
    this.disposed = true;
    void this.pending?.then((client) => client.dispose()).catch(() => {});
  }
}
