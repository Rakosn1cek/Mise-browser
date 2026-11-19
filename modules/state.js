// Central state store for browser session, view caches, and overlay states
export const state = {
    sessionState: {
        current_workspace: "Workspace 1",
        workspaces: { "Workspace 1": ["https://duckduckgo.com"] },
        active_tabs: { "Workspace 1": 0 },
        workspace_visuals: {}
    },
    activeViewsCache: {},
    activeTitlesCache: {},
    tabSleepStates: {},
    tabActivityTimestamps: {},
    tabMediaAudible: {},
    tabAudioMuted: {},
    tabPinned: {},
    tabFavicons: {},
    tabHistory: {},
    tabDarkReaderStates: {},
    tabZoomFactors: {},
    splitStates: {},
    appVersion: '',
    
    // UI Active Flags
    dashboardActive: false,
    paletteActive: false,
    preferencesActive: false,
    historyActive: false,
    keepHistory: true,
    globalPrivateModeActive: false,
    notesActive: false,
    isEditingNotes: false,
    isNotesExpanded: false,
    bookmarksActive: false,
    diagnosticsActive: false,
    notificationsActive: false,
    qrModalActive: false,
    taskManagerActive: false,
    taskManagerSelectionIdx: 0,
    notificationsFilter: 'all',
    notificationsSelectionIdx: 0,
    awaitingQuickmarkKey: false,
    quickmarkMode: null,

    // Overlay Data Caches
    dashboardItems: [],
    dashboardSelectionIdx: 0,
    dashboardExpandedWorkspaces: {},
    paletteMatches: [],
    paletteSelectionIdx: 0,
    historyResults: [],
    historySelectionIdx: 0,
    addressSuggestions: [],
    addressSelectionIdx: -1,
    customSearchAliases: {},
    
    // Bookmarks and Quickmarks State
    quickmarks: {},
    bookmarks: [],
    bookmarkActiveColumn: 'quickmarks',
    quickmarkSelectionIdx: 0,
    bookmarkSelectionIdx: 0,
    filteredQuickmarksCache: [],
    filteredBookmarksCache: []
};
