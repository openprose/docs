import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: (
        <span className="op-wordmark" aria-label={appName}>
          <span>Open</span>
          <span>Prose</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    // The site is light-only by design; without this the sidebar still
    // renders a theme toggle even though the theme provider is disabled.
    themeSwitch: { enabled: false },
  };
}
