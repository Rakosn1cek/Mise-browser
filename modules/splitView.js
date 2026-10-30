// modules/splitView.js
// Backwards-compatible proxy re-exporting split view controller from webview subsystem

export {
    getSplitState,
    isSplitActive,
    applySplitLayout,
    toggleSplitView,
    cycleSplitOrientation,
    switchSplitFocus,
    swapSplitPanes,
    closeSplitView,
    handleSplitTabSelection,
    handleTabRemovalInSplit,
    openUrlInSplit
} from './webview/splitView.js';
