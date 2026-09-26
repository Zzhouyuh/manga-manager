const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // 已有接口
    pickDirectory: () => ipcRenderer.invoke('pick-directory'),
    scanAndImport: (dir) => ipcRenderer.invoke('scan-and-import', dir),
    // ⭐ 选文件导入（mobi / azw3 / epub / cbz ...）
    pickFiles: () => ipcRenderer.invoke('pick-files'),
    importFiles: (filePaths) => ipcRenderer.invoke('import-files', filePaths),
    // ⭐ 导入进度推送：cb({ phase, current, total, name })，返回取消订阅函数
    onImportProgress: (cb) => {
        const listener = (_event, payload) => cb(payload);
        ipcRenderer.on('import-progress', listener);
        return () => ipcRenderer.removeListener('import-progress', listener);
    },
    listSeries: () => ipcRenderer.invoke('list-series'),
    listChapters: (seriesId) => ipcRenderer.invoke('list-chapters', seriesId),
    getSeriesCover: (seriesId, mode) => ipcRenderer.invoke('get-series-cover', seriesId, mode),
    listChapterImages: (chapterId) => ipcRenderer.invoke('list-chapter-images', chapterId),
    getImage: (imagePath) => ipcRenderer.invoke('get-image', imagePath),
    // ⭐ 缩略图（图片墙/收藏页用，主进程会缓存到 userData/thumbs）
    getThumbnail: (imagePath, maxWidth) => ipcRenderer.invoke('get-thumbnail', imagePath, maxWidth),
    // ⭐ 走 manga:// 协议直接取图（推荐，<img src=...> 用这个；不走 base64）
    imageUrl: (imagePath, maxWidth) => (maxWidth
        ? `manga://thumb/${maxWidth}/${encodeURIComponent(imagePath)}`
        : `manga://img/${encodeURIComponent(imagePath)}`),
    // ⭐ 系列封面也走 manga:// 协议（卡片网格一次几十张，省掉 base64）
    coverUrl: (seriesId, mode) => `manga://cover/${seriesId}/${mode === 'static' ? 'static' : 'dynamic'}`,
    updateProgress: (chapterId, page) => ipcRenderer.invoke('update-progress', chapterId, page),
    recentReading: () => ipcRenderer.invoke('recent-reading'),
    searchSeries: (keyword, tagId) => ipcRenderer.invoke('search-series', keyword, tagId),
    // ⭐ 标签
    listTags: () => ipcRenderer.invoke('list-tags'),
    createTag: (name, color) => ipcRenderer.invoke('create-tag', name, color),
    deleteTag: (tagId) => ipcRenderer.invoke('delete-tag', tagId),
    getSeriesTags: (seriesId) => ipcRenderer.invoke('get-series-tags', seriesId),
    setSeriesTags: (seriesId, tagIds) => ipcRenderer.invoke('set-series-tags', seriesId, tagIds),
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
});
