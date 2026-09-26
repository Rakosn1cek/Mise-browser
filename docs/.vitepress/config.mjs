import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Mise Browser',
  description: 'Keyboard-first, container-isolated web browser for fanless Linux systems',
  base: '/Mise-browser/',
  head: [
    ['link', { rel: 'icon', href: '/Mise-browser/logo.png' }]
  ],
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Mise Browser',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/guide/navigation' },
      { text: 'Reference', link: '/reference/keybinds' },
      { text: 'GitHub', link: 'https://github.com/Rakosn1cek/Mise-browser' }
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Overview & Philosophy', link: '/guide/getting-started' },
          { text: 'Installation & Setup', link: '/guide/installation' }
        ]
      },
      {
        text: 'Core Features',
        items: [
          { text: 'Mouse-Free Navigation', link: '/guide/navigation' },
          { text: 'Workspaces & Containers', link: '/guide/workspaces-and-containers' },
          { text: 'True Tab Hibernation', link: '/guide/tab-hibernation' },
          { text: 'Privacy & Trusted Sites', link: '/guide/privacy-and-shields' },
          { text: 'Notes, Bookmarks & Quickmarks', link: '/guide/notes-and-bookmarks' },
          { text: 'Terminal Security & Oversight', link: '/guide/terminal-oversight' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Keyboard Shortcuts', link: '/reference/keybinds' },
          { text: 'Command Palette', link: '/reference/command-palette' },
          { text: 'Configuration Files', link: '/reference/configuration' }
        ]
      }
    ],
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Rakosn1cek/Mise-browser' }
    ],
    footer: {
      message: 'Released under the GNU General Public Licence v3.0.',
      copyright: 'Copyright © 2026 Mise Browser Project'
    }
  }
});
