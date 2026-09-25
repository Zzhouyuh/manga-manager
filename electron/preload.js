const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 已有接口
    pickDirectory: () => ipcRenderer.invoke('pick-directory'),
    scanAndImport: (dir) => ipcRenderer.invoke('scan-and-import', dir),
    listSeries: () => ipcRenderer.invoke('list-series'),
    listChapters: (seriesId) => ipcRenderer.invoke('list-chapters', seriesId),
    getSeriesCover: (seriesId, mode) => ipcRenderer.invoke('get-series-cover', seriesId, mode),
    listChapterImages: (chapterId) => ipcRenderer.invoke('list-chapter-images', chapterId),
    getImage: (imagePath) => ipcRenderer.invoke('get-image', imagePath),
    updateProgress: (chapterId, page) => ipcRenderer.invoke('update-progress', chapterId, page),
    recentReading: () => ipcRenderer.invoke('recent-reading'),
    searchSeries: (keyword) => ipcRenderer.invoke('search-series', keyword),
    deleteSeries: (seriesId) => ipcRenderer.invoke('delete-series', seriesId),
    deleteChapter: (chapterId) => ipcRenderer.invoke('delete-chapter', chapterId),

    // ⭐ 收藏接口
    favoritePage: (chapterId, pageIndex, imagePath) =>
        ipcRenderer.invoke('favorite-page', chapterId, pageIndex, imagePath),
    unfavoritePage: (chapterId, pageIndex) =>
        ipcRenderer.invoke('unfavorite-page', chapterId, pageIndex),
    isPageFavorited: (chapterId, pageIndex) =>
        ipcRenderer.invoke('is-page-favorited', chapterId, pageIndex),
    listFavoritePages: () => ipcRenderer.invoke('list-favorite-pages'),
    toggleFavoriteSeries: (seriesId) =>
        ipcRenderer.invoke('toggle-favorite-series', seriesId),
    listFavoriteSeries: () => ipcRenderer.invoke('list-favorite-series'),
    deleteFavoritePage: (favoriteId) =>
        ipcRenderer.invoke('delete-favorite-page', favoriteId),
    // ⭐ epub 支持（在最后加）
    epubListImages: (epubPath) => ipcRenderer.invoke('epub-list-images', epubPath),
    epubGetImage: (epubPath, href) => ipcRenderer.invoke('epub-get-image', epubPath, href),
});