import { app } from 'electron'

export const APP_NAME = 'CuePoint'
export const APP_AUTHOR = 'Sandila Fernando'
/** Subtle product credit shown in the status bar, About dialog and documentation. */
export const APP_COPYRIGHT = '© 2026 Sandila Fernando'
export const APP_LICENSE = 'MIT'

/** Uses the packaged application version so About always matches the installed build. */
export const APP_VERSION: string = app?.getVersion?.() ?? '1.0.0'

export interface DocFile {
  id: string
  file: string
  title: string
  description: string
}

export const DOC_FILES: DocFile[] = [
  {
    id: 'user-manual',
    file: 'USER_MANUAL.md',
    title: 'CuePoint User Manual',
    description: 'Complete operator guide: projects, stage design, mapping, NDI and recording.'
  },
  {
    id: 'architecture',
    file: 'ARCHITECTURE.md',
    title: 'Architecture',
    description: 'How the Electron processes, NDI helper, storage and export pipeline fit together.'
  },
  {
    id: 'testing',
    file: 'TESTING.md',
    title: 'Testing & Measurements',
    description: 'Automated test coverage and the measured performance results for this build.'
  },
  {
    id: 'troubleshooting',
    file: 'TROUBLESHOOTING.md',
    title: 'Troubleshooting',
    description: 'Common problems, error messages and how to resolve them.'
  },
  {
    id: 'user-manual-pdf',
    file: 'CuePoint_User_Manual.pdf',
    title: 'User Manual (PDF)',
    description: 'Printable version of the user manual.'
  }
]
