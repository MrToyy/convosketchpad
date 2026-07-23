import { describe, expect, it, vi } from 'vitest';
import guides from './deployment-guides.json';
import { printDeploymentGuides, shouldPrintDeploymentGuides } from './deployment-guides.js';

describe('deployment guide metadata', () => {
  it('prints in standalone setup flows', () => {
    expect(shouldPrintDeploymentGuides({ invokedFromInstaller: false, defaultsMode: false })).toBe(true);
    expect(shouldPrintDeploymentGuides({ invokedFromInstaller: false, defaultsMode: true })).toBe(true);
  });

  it('skips setup-side printing for installer defaults flow', () => {
    expect(shouldPrintDeploymentGuides({ invokedFromInstaller: true, defaultsMode: true })).toBe(false);
  });

  it('contains the expected public docs links and human-readable titles', () => {
    expect(guides).toEqual([
      {
        title: 'Run everything on one machine',
        url: 'https://docs.nerve.zone/guide/deployment-local',
      },
      {
        title: 'Use a cloud Gateway with ConvoSketchpad on your laptop',
        url: 'https://docs.nerve.zone/guide/deployment-remote-gateway',
      },
      {
        title: 'Run both ConvoSketchpad and Gateway in the cloud',
        url: 'https://docs.nerve.zone/guide/deployment-cloud',
      },
    ]);
  });

  it('prints the rendered deployment guide block', () => {
    const log = vi.fn();

    printDeploymentGuides(log);

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '  Deployment guides:',
      ...guides.map((guide) => `    ${guide.title}: \x1b[36m${guide.url}\x1b[0m`),
      '',
    ]);
  });
});
